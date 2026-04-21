export interface Deck {
    id: string;
    name: string;
    createdAt: number;
    /** С сервера: сколько карточек к повторению сейчас */
    dueCount?: number;
}

export interface Card {
    id: string;
    deckId: string;
    front: string;
    back: string;

    // --- Логика интервальных повторений (Anki-style) ---
    status: 'learning' | 'review'; // В какой фазе карточка
    step: number;       // Текущий шаг в фазе learning (индекс массива)

    dueDate: number;    // Timestamp следующего показа
    interval: number;   // Интервал (в днях, используется только для 'review')
    repetition: number; // Количество успешных повторений подряд
    efactor: number;    // Коэффициент легкости (меняется только в фазе 'review')
}

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/** Пропсы remote-виджета для host-приложения (module federation) */
export interface AnkiWidgetHostProps {
  authToken?: string | null;
  apiBaseUrl?: string | null;
  mode?: 'full' | 'training-only';
  targetDeckId?: string | null;
  limit?: number;
  fetchAllDueCards?: boolean;
}