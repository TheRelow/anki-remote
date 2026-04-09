// src/store/ankiStore.ts
import { defineStore } from 'pinia';
import { useLocalStorage } from '@vueuse/core';
import { computed } from 'vue';
import { v4 as uuidv4 } from 'uuid';
import type { Deck, Card, Grade } from '../types';
import { calculateNextReview } from '../utils/sm2';

export const useAnkiStore = defineStore('ankiStore', () => {
    // === STATE (Состояние, сохраняется в localStorage) ===
    const decks = useLocalStorage<Deck[]>('anki-decks', []);
    const cards = useLocalStorage<Card[]>('anki-cards', []);

    // === GETTERS (Вычисляемые значения) ===

    // Получить все карточки, которые нужно повторить сегодня (или раньше)
    const cardsDueToday = computed(() => {
        const now = Date.now();
        return cards.value.filter(card => card.dueDate <= now);
    });

    // Получить карточки для конкретной колоды на сегодня
    const getDueCardsByDeck = computed(() => {
        return (deckId: string) => cardsDueToday.value.filter(c => c.deckId === deckId);
    });

    // === ACTIONS (Методы) ===

    function addDeck(name: string) {
        const newDeck: Deck = {
            id: uuidv4(), // встроенная генерация ID в современных браузерах
            name,
            createdAt: Date.now()
        };
        decks.value.push(newDeck);
    }

    function addCard(deckId: string, front: string, back: string) {
        const newCard: Card = {
            id: uuidv4(),
            deckId,
            front,
            back,
            dueDate: Date.now(), // Сразу доступна для изучения
            interval: 0,
            repetition: 0,
            efactor: 2.5
        };
        cards.value.push(newCard);
    }

    function deleteCard(cardId: string) {
        cards.value = cards.value.filter(c => c.id !== cardId);
    }

    /**
     * Главная функция тренировки.
     * Вызывается, когда пользователь нажимает "Забыл", "Трудно", "Нормально" или "Легко"
     */
    function reviewCard(cardId: string, grade: Grade) {
        const cardIndex = cards.value.findIndex(c => c.id === cardId);
        if (cardIndex === -1) return;

        const card = cards.value[cardIndex];

        // Рассчитываем новые параметры с помощью нашей утилиты SM-2
        const updatedParams = calculateNextReview(card, grade);

        // Обновляем карточку в сторе (и localStorage автоматически)
        cards.value[cardIndex] = { ...card, ...updatedParams };
    }

    return {
        decks,
        cards,
        cardsDueToday,
        getDueCardsByDeck,
        addDeck,
        addCard,
        deleteCard,
        reviewCard
    };
});