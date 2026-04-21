<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import BaseButton from "./BaseButton.vue";
import Training from "./Training.vue";
import CardWorker from "./CardWorker.vue";
import DeckDetail from "./DeckDetail.vue";
import DeckList from "./DeckList.vue";
import { useAnkiStore } from '../store/ankiStore'
import type { AnkiWidgetHostProps } from '../types'

type Screen = 'menu' | 'decks' | 'deck-detail' | 'card-worker' | 'training';

const emit = defineEmits<{
  (e: 'finished', args: number): void
  (e: 'auth-error', message: string): void
}>();

const props = withDefaults(defineProps<AnkiWidgetHostProps>(), {
  mode: 'full',
  targetDeckId: null,
  limit: undefined,
  authToken: null,
  apiBaseUrl: null,
  fetchAllDueCards: false,
})

const store = useAnkiStore()

const currentScreen = ref<Screen>('menu')
const activeDeckId = ref<string | null>(null)
const initError = ref<string | null>(null)

const resolvedToken = computed(() => {
  if (props.authToken !== null && props.authToken !== undefined && String(props.authToken).trim()) {
    return String(props.authToken).trim()
  }
  const t = import.meta.env.VITE_ANKI_DEV_TOKEN
  return typeof t === 'string' && t.trim() ? t.trim() : null
})

onMounted(async () => {
  initError.value = null
  store.setAuth(resolvedToken.value, props.apiBaseUrl ?? undefined)
  if (!store.authToken) {
    initError.value = 'Нет токена: передайте authToken из host или VITE_ANKI_DEV_TOKEN для локальной разработки.'
    emit('auth-error', initError.value)
    return
  }
  try {
    if (props.mode === 'training-only') {
      activeDeckId.value = props.targetDeckId || 'all'
      currentScreen.value = 'training'
    } else {
      await store.loadDecks()
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    initError.value = msg
    emit('auth-error', msg)
  }
})

watch(currentScreen, async (s, prev) => {
  if (prev === 'training' && s !== 'training') {
    store.resetTrainingQueue()
  }
  if (s === 'decks' && store.authToken) {
    try {
      await store.loadDecks()
    } catch {
      /* ignore */
    }
  }
})

const headerTitle = computed(() => {
  switch (currentScreen.value) {
    case 'menu': return 'Меню';
    case 'decks': return 'Список колод';
    case 'deck-detail': return 'Колода';
    case 'card-worker': return 'Создание карточки';
    case 'training': return 'Тренировка';
    default: return '';
  }
});

function goBack() {
  if (props.mode === 'training-only') return;

  if (currentScreen.value === 'training' || currentScreen.value === 'deck-detail') {
    currentScreen.value = 'decks'
  } else {
    currentScreen.value = 'menu'
  }
}

function handleTrainingFinished(args: number) {
  emit('finished', args);
}

async function openTraining(deckId: string) {
  activeDeckId.value = deckId
  currentScreen.value = 'training'
}

function openDeckDetail(deckId: string) {
  activeDeckId.value = deckId
  currentScreen.value = 'deck-detail'
}
</script>

<template>
  <div class="anki-container">

    <div v-if="initError" class="anki-error">
      {{ initError }}
    </div>

    <div v-else-if="store.showOfflineHint" class="anki-offline-hint">
      Локальные данные: часть информации с устройства; синхронизация при подключении к серверу.
    </div>

    <div class="controls" :style="{ display: (currentScreen === 'menu' || mode === 'training-only') ? 'none' : undefined }">
      <button
        class="controls__btn"
        @click="goBack"
      >
        ⬅
      </button>

      <div class="controls__heading">{{ headerTitle }}</div>

      <button class="controls__btn" style="visibility: hidden;">
      </button>
    </div>

    <div class="anki-container__content">

      <div v-if="currentScreen === 'menu'" class="main-menu">
        <BaseButton @click="currentScreen = 'card-worker'">Создать карточку</BaseButton>
        <BaseButton @click="currentScreen = 'deck-detail'">Создать колоду</BaseButton>
        <BaseButton @click="currentScreen = 'decks'">Список колод</BaseButton>
        <BaseButton @click="openTraining('all')">Перейти к изучению</BaseButton>
      </div>

      <DeckList
        v-else-if="currentScreen === 'decks'"
        @start="openTraining"
        @details="openDeckDetail"
      />

      <DeckDetail
        v-else-if="currentScreen === 'deck-detail'"
        :deck-id="activeDeckId"
      />

      <CardWorker
        v-else-if="currentScreen === 'card-worker'"
        :deck-id="activeDeckId"
      />

      <Training
        v-else-if="currentScreen === 'training'"
        :deck-id="activeDeckId"
        :limit="limit"
        :fetch-all-due="fetchAllDueCards"
        @finished="handleTrainingFinished"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.anki-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: 'Inter', sans-serif;
  color: var(--anki-text-main);
  background-color: #ffffff;

  --anki-text-main: #1f2937;
  --anki-text-muted: #6b7280;
  --anki-bg-body: #f9fafb;
  --anki-bg-surface: #ffffff;

  --anki-primary: #3b82f6;
  --anki-primary-hover: #2563eb;

  --anki-success: #10b981;
  --anki-success-hover: #059669;

  --anki-warning: #f59e0b;
  --anki-warning-hover: #d97706;

  --anki-danger: #ef4444;
  --anki-danger-hover: #dc2626;

  --anki-gray: #e5e7eb;
  --anki-gray-hover: #d1d5db;

  --anki-radius: 12px;
  --anki-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  --anki-transition: all 0.2s ease-in-out;

  &, *, *::before, *::after {
    box-sizing: border-box;
  }
}

.anki-error {
  padding: 10px 12px;
  margin: 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #991b1b;
  font-size: 0.9rem;
}

.anki-offline-hint {
  padding: 8px 12px;
  margin: 10px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  color: #0369a1;
  font-size: 0.85rem;
}

.controls {
  flex-shrink: 0;
  height: 60px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px;
  background-color: #f8f9fa;
  border-bottom: 1px solid #e7e7e7;
}

.controls__btn {
  height: 40px;
  width: 40px;
  border-radius: 50%;
  border: none;
  background-color: #e7e7e7;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background-color: #d0d0d0;
  }
}

.controls__heading {
  font-weight: bold;
  font-size: 1.1rem;
}

.anki-container__content {
  flex-grow: 1;
  overflow-y: auto;
  padding: 15px;
}

.main-menu {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  width: 300px;
  margin: 0 auto;
  gap: 15px;
}
</style>
