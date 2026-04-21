<!-- src/components/DeckList.vue -->
<script setup lang="ts">
import { useAnkiStore } from '../store/ankiStore'
import BaseButton from './BaseButton.vue'

const store = useAnkiStore()

const emit = defineEmits<{
  (e: 'start', deckId: string): void;
  (e: 'details', deckId: string): void;
}>()
</script>

<template>
  <div class="deck-list">
    <div v-if="store.decks.length === 0" class="empty-state">
      У вас пока нет колод. Создайте первую!
    </div>

    <div v-for="deck in store.decks" :key="deck.id" class="deck-item">
      <div class="deck-item__info">
        <h3>{{ deck.name }}</h3>
        <!-- Тут можно вывести количество карточек для повторения -->
        <span class="badge">{{ store.dueCountForDeck(deck.id) }} ждут повторения</span>
      </div>

      <div class="deck-item__actions">
        <BaseButton variant="secondary" @click="emit('details', deck.id)">Настроить</BaseButton>
        <BaseButton variant="primary" @click="emit('start', deck.id)">Учить</BaseButton>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.deck-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.deck-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border: 1px solid var(--anki-gray);
  border-radius: 12px;

  &__info h3 { margin-bottom: 5px; }
  &__actions { display: flex; gap: 10px; }
}
.badge {
  font-size: 0.8rem;
  color: var(--anki-warning);
}
</style>