<!-- src/components/Training.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import BaseButton from './BaseButton.vue'
import type { Grade } from '../types'

const props = defineProps<{
  deckId?: string | null;
  limit?: number;
  fetchAllDue?: boolean;
}>()

const emit = defineEmits<{
  (e: 'finished', reviewedCount: number): void
}>()

const store = useAnkiStore()
const isFlipped = ref(false)
const reviewedCount = ref(0)
const sessionStarted = ref(false)
const sessionLoadError = ref<string | null>(null)
const reviewError = ref<string | null>(null)

watch(
  () => [props.deckId, props.fetchAllDue] as const,
  async ([deckId, fetchAll]) => {
    if (!deckId) return
    sessionStarted.value = false
    sessionLoadError.value = null
    reviewError.value = null
    reviewedCount.value = 0
    isFlipped.value = false
    try {
      await store.beginTrainingSession(deckId, { fetchAllDue: fetchAll ?? false })
      sessionStarted.value = true
      if (!currentCard.value) {
        emit('finished', reviewedCount.value)
      }
    } catch (e) {
      sessionLoadError.value = e instanceof Error ? e.message : String(e)
    }
  },
  { immediate: true }
)

const currentCard = computed(() => {
  if (props.limit && props.limit > 0 && reviewedCount.value >= props.limit) {
    return null
  }
  return store.currentTrainingCard
})

const currentDeckName = computed(() => {
  if (!currentCard.value) return ''
  const deck = store.decks.find(d => d.id === currentCard.value!.deckId)
  return deck?.name || 'Неизвестная колода'
})

watch(
  currentCard,
  (c, prev) => {
    if (!sessionStarted.value) return
    if (!c && prev !== undefined) {
      emit('finished', reviewedCount.value)
    }
  }
)

async function handleAnswer(grade: Grade) {
  if (!currentCard.value) return

  reviewError.value = null
  try {
    await store.reviewCardInSession(currentCard.value.id, grade)
    reviewedCount.value++
    isFlipped.value = false
  } catch (e) {
    reviewError.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <div class="training">
    <p v-if="sessionLoadError" class="training__alert training__alert--error" role="alert">
      {{ sessionLoadError }}
    </p>
    <p v-else-if="store.showOfflineHint" class="training__alert training__alert--muted">
      Локальные данные: ответы сохраняются на устройстве и синхронизируются с сервером при подключении.
    </p>
    <p v-if="reviewError" class="training__alert training__alert--error" role="alert">
      {{ reviewError }}
    </p>

    <div v-if="currentCard" class="card-container">

      <div class="deck-badge">
        Колода: <strong>{{ currentDeckName }}</strong>
      </div>

      <div class="flashcard">
        <div class="flashcard__front">
          {{ currentCard.front }}
        </div>

        <div v-if="isFlipped" class="flashcard__divider"></div>

        <div v-if="isFlipped" class="flashcard__back">
          {{ currentCard.back }}
        </div>
      </div>

      <div class="controls">
        <BaseButton
          v-if="!isFlipped"
          block
          variant="primary"
          @click="isFlipped = true"
        >
          Показать ответ
        </BaseButton>

        <div v-else class="grade-buttons">
          <BaseButton variant="danger" @click="handleAnswer('again')">Снова</BaseButton>
          <BaseButton variant="warning" @click="handleAnswer('hard')">Трудно</BaseButton>
          <BaseButton variant="primary" @click="handleAnswer('good')">Норм</BaseButton>
          <BaseButton variant="success" @click="handleAnswer('easy')">Легко</BaseButton>
        </div>
      </div>

    </div>

    <div v-else-if="!sessionLoadError" class="done-state">
      <h2>🎉 Отлично!</h2>
      <p v-if="limit && reviewedCount >= limit">
        Тренировка окончена! Вы достигли лимита на эту сессию.
      </p>
      <p v-else>
        На сегодня больше нет карточек для повторения.
      </p>

      <p class="stats">
        Пройдено карточек: <strong>{{ reviewedCount }}</strong>
      </p>
    </div>
  </div>
</template>

<style scoped lang="scss">
.training {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
}

.training__alert {
  width: 100%;
  max-width: 500px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 0.9rem;
  text-align: center;

  &--error {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
  }

  &--muted {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    color: #0369a1;
  }
}
.card-container {
  width: 100%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.deck-badge {
  text-align: center;
  font-size: 0.9rem;
  color: var(--anki-primary, #666);
  background: rgba(0, 0, 0, 0.05);
  padding: 4px 12px;
  border-radius: 12px;
  align-self: center;
}

.flashcard {
  background: white;
  border: 1px solid var(--anki-gray);
  border-radius: 12px;
  padding: 20px;
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  text-align: center;
  font-size: 1.2rem;
  box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);

  &__divider {
    height: 1px;
    background: var(--anki-gray);
    margin: 20px 0;
  }
}
.grade-buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.done-state {
  text-align: center;
  margin: 50px 0;

  .stats {
    margin-top: 20px;
    font-size: 1.1rem;
    color: var(--anki-primary, #666);
  }
}
</style>
