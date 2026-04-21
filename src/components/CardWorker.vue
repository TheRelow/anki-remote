<!-- src/components/CardWorker.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import BaseInput from './BaseInput.vue'
import BaseButton from './BaseButton.vue'

const props = defineProps<{
  deckId?: string | null;
  cardId?: string | null;
}>()

const store = useAnkiStore()

const selectedDeckId = ref(props.deckId || '')
const frontText = ref('')
const backText = ref('')

async function saveCard() {
  if (!selectedDeckId.value || !frontText.value || !backText.value) {
    alert('Заполните все поля!')
    return
  }

  try {
    await store.addCard(selectedDeckId.value, frontText.value, backText.value)

    frontText.value = ''
    backText.value = ''
    alert('Карточка добавлена!')
  } catch {
    alert(store.lastError || 'Ошибка сохранения')
  }
}
</script>

<template>
  <div class="card-worker">
    <div class="select-wrapper">
      <label>Колода</label>
      <select v-model="selectedDeckId" class="base-select">
        <option disabled value="">Выберите колоду...</option>
        <option v-for="deck in store.decks" :key="deck.id" :value="deck.id">
          {{ deck.name }}
        </option>
      </select>
    </div>

    <BaseInput v-model="frontText" label="Лицевая сторона (Вопрос)" multiline />
    <BaseInput v-model="backText" label="Обратная сторона (Ответ)" multiline />

    <BaseButton block variant="success" @click="saveCard" style="margin-top: 10px;">
      Сохранить карточку
    </BaseButton>
  </div>
</template>

<style scoped lang="scss">
.card-worker {
  display: flex;
  flex-direction: column;
  gap: 15px;
}
.select-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;

  label { font-size: 0.9rem; font-weight: 600; color: var(--anki-text-muted); }
}
.base-select {
  padding: 10px 12px;
  border: 1px solid var(--anki-gray);
  border-radius: 8px;
  font-size: 1rem;
}
</style>
