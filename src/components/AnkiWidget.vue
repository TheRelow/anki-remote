<!-- src/components/AnkiWidget.vue -->
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import DeckList from './DeckList.vue'
import Training from './Training.vue'

// 1. Описываем пропсы
const props = withDefaults(defineProps<{
  mode?: 'full' | 'training-only'; // Режим работы
  targetDeckId?: string | null;    // ID конкретной колоды (опционально)
}>(), {
  mode: 'full',
  targetDeckId: null
})

const store = useAnkiStore()
const currentScreen = ref('decks')
const activeDeckId = ref<string | null>(null)

// 2. Логика инициализации в зависимости от пропсов
onMounted(() => {
  if (props.mode === 'training-only') {
    // Если передали конкретную колоду — берем ее
    if (props.targetDeckId) {
      activeDeckId.value = props.targetDeckId
    }
      // Иначе (например) просто будем тренировать ВСЕ карточки,
    // у которых подошел срок
    else {
      activeDeckId.value = 'all' // В Training.vue нужно будет обработать этот случай
    }

    // Сразу переключаем экран, минуя список колод
    currentScreen.value = 'training'
  }
})

function startTraining(deckId: string) {
  activeDeckId.value = deckId
  currentScreen.value = 'training'
}

// Если мы в режиме training-only, запрещаем выходить назад
function handleBack() {
  if (props.mode !== 'training-only') {
    currentScreen.value = 'decks'
  }
}
</script>

<template>
  <div class="anki-container">
    <DeckList
      v-if="currentScreen === 'decks'"
      @start="startTraining"
    />

    <Training
      v-else-if="currentScreen === 'training'"
      :deck-id="activeDeckId"
      :hide-back-button="props.mode === 'training-only'"
      @back="handleBack"
    />
  </div>
</template>