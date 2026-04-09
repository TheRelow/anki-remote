import type { Card, Grade } from '../types';

/**
 * Функция рассчитывает новые параметры карточки на основе ответа пользователя
 */
export function calculateNextReview(card: Card, grade: Grade): Partial<Card> {
    let { interval, repetition, efactor } = card;
    let quality = 0;

    // Маппинг кнопок на качество ответа (Quality) от 0 до 5
    switch (grade) {
        case 'again': quality = 0; break; // Полностью забыл
        case 'hard':  quality = 3; break; // Вспомнил с трудом
        case 'good':  quality = 4; break; // Нормально вспомнил (стандарт)
        case 'easy':  quality = 5; break; // Легко
    }

    // Если ответил неправильно (Again)
    if (quality < 3) {
        repetition = 0;
        interval = 1; // Возвращаем карточку на завтра (или можно сделать в тот же день, если interval = 0)
    } else {
        // Если ответил правильно
        if (repetition === 0) {
            interval = 1;
        } else if (repetition === 1) {
            interval = 6;
        } else {
            interval = Math.round(interval * efactor);
        }
        repetition += 1;
    }

    // Пересчет коэффициента легкости (E-factor)
    efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3; // E-factor не может быть ниже 1.3

    // Вычисляем новую дату показа (текущее время + интервал в днях)
    const oneDay = 24 * 60 * 60 * 1000;
    const dueDate = Date.now() + interval * oneDay;

    return {
        interval,
        repetition,
        efactor,
        dueDate
    };
}