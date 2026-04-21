<!-- src/components/DeckDetail.vue -->
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import BaseInput from './BaseInput.vue'
import BaseButton from './BaseButton.vue'

const props = defineProps<{
  deckId?: string | null;
}>()

const store = useAnkiStore()
const deckName = ref('')

function syncName() {
  if (props.deckId) {
    const deck = store.decks.find(d => d.id === props.deckId)
    if (deck) deckName.value = deck.name
  } else {
    deckName.value = ''
  }
}

onMounted(syncName)
watch(() => [props.deckId, store.decks], syncName, { deep: true })

async function save() {
  if (!deckName.value.trim()) return

  try {
    if (props.deckId) {
      await store.updateDeck(props.deckId, deckName.value.trim())
    } else {
      await store.addDeck(deckName.value.trim())
    }
    deckName.value = ''
    alert('Сохранено!')
  } catch {
    alert(store.lastError || 'Ошибка сохранения')
  }
}
</script>

<template>
  <div class="deck-detail">
    <BaseInput
      v-model="deckName"
      label="Название колоды"
      placeholder="Например: Английский язык"
    />
    <BaseButton block @click="save" style="margin-top: 15px;">
      {{ props.deckId ? 'Сохранить изменения' : 'Создать колоду' }}
    </BaseButton>
  </div>
</template>
