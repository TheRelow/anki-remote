export interface Deck {
    id: string;
    name: string;
    createdAt: number;
}

export interface Card {
    id: string;
    deckId: string;
    front: string; // Вопрос (лицевая сторона)
    back: string;  // Ответ (обратная сторона)

    // --- Логика интервальных повторений (Spaced Repetition) ---
    dueDate: number;    // Timestamp (в миллисекундах), когда карточку нужно показать снова
    interval: number;   // Текущий интервал в днях
    repetition: number; // Количество успешных повторений подряд
    efactor: number;    // E-factor (Коэффициент легкости, по умолчанию 2.5)
}

// Оценки, которые пользователь ставит при ответе
export type Grade = 'again' | 'hard' | 'good' | 'easy';