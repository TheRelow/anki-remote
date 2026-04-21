// src/utils/sm2.ts
import type { Card, Grade } from '../types';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

// Шаги изучения в миллисекундах. Классика Anki: 1 минута, затем 10 минут.
const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];

export function calculateNextReview(card: Card, grade: Grade): Partial<Card> {
    // Делаем копии текущих значений
    let { status, step, interval, repetition, efactor } = card;
    let dueDate = Date.now();

    if (status === 'new') {
        status = 'learning';
        step = 0;
        interval = 0;
        repetition = 0;
    }

    // ==========================================
    // ФАЗА 1: LEARNING (Изучение - короткие шаги)
    // ==========================================
    if (status === 'learning') {
        if (grade === 'again') {
            step = 0; // Сброс на первый шаг (1 минута)
            dueDate += LEARNING_STEPS[step];
        }
        else if (grade === 'hard') {
            // Повторяем текущий шаг
            dueDate += LEARNING_STEPS[step];
        }
        else if (grade === 'good') {
            step += 1;
            // Если шаги закончились - выпускаем карточку (graduate)
            if (step >= LEARNING_STEPS.length) {
                status = 'review';
                interval = 1; // Завтра
                repetition = 1;
                dueDate += interval * DAY;
            } else {
                // Иначе переходим на следующий шаг (например, 10 минут)
                dueDate += LEARNING_STEPS[step];
            }
        }
        else if (grade === 'easy') {
            // Мгновенный выпуск (graduate) с бОльшим интервалом
            status = 'review';
            interval = 4; // Через 4 дня
            repetition = 1;
            dueDate += interval * DAY;
        }

        // Заметь: в фазе learning efactor (сложность) НЕ меняется.
        // Это спасает карточку от вечного "убивания" её рейтинга на этапе первоначального заучивания.

        return { status, step, interval, repetition, efactor, dueDate };
    }


    // ==========================================
    // ФАЗА 2: REVIEW (Повторение - классический SM-2)
    // ==========================================
    let quality = 0;
    switch (grade) {
        case 'again': quality = 0; break;
        case 'hard':  quality = 3; break;
        case 'good':  quality = 4; break;
        case 'easy':  quality = 5; break;
    }

    if (quality < 3) {
        // Забыл карту, которая уже была выучена (Lapse)
        status = 'learning'; // Отправляем на переобучение
        step = 0;
        repetition = 0;
        interval = 0;
        dueDate += LEARNING_STEPS[0]; // Снова покажем через 1 минуту
    } else {
        // Успешное повторение
        if (repetition === 0) {
            interval = 1;
        } else if (repetition === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * efactor);
        }
        repetition += 1;
        dueDate += interval * DAY;
    }

    // Пересчитываем E-factor только в фазе Review
    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;

    return { status, step, interval, repetition, efactor, dueDate };
}