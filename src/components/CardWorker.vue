<!-- src/components/CardWorker.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import BaseInput from './BaseInput.vue'
import BaseButton from './BaseButton.vue'

const props = defineProps<{
  deckId?: string | null;
  cardId?: string | null;
}>()

const store = useAnkiStore()

const selectedDeckId = ref(props.deckId || '')
const fieldValues = ref<Record<string, string>>({})

const selectedDeck = computed(() => store.decks.find((d) => d.id === selectedDeckId.value) ?? null)
const deckFields = computed(() => {
  const schema = selectedDeck.value?.fieldSchema;
  if (!schema?.fields?.length) {
    return [
      { id: 'front', type: 'text', required: true },
      { id: 'back', type: 'text', required: true },
    ];
  }
  return schema.fields;
})

function fieldLabel(fieldId: string): string {
  if (fieldId === 'front') return 'Лицевая сторона (Вопрос)';
  if (fieldId === 'back') return 'Обратная сторона (Ответ)';
  return fieldId;
}

async function saveCard() {
  if (!selectedDeckId.value) {
    alert('Выберите колоду!');
    return
  }
  const fields: Record<string, string> = {};
  for (const field of deckFields.value) {
    const value = (fieldValues.value[field.id] ?? '').trim();
    if (field.required && !value) {
      alert(`Поле "${fieldLabel(field.id)}" обязательно`);
      return;
    }
    if (value) fields[field.id] = value;
  }
  if (Object.keys(fields).length === 0) {
    alert('Заполните хотя бы одно поле');
    return
  }

  try {
    await store.addCard(selectedDeckId.value, fields)
    fieldValues.value = {}
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

    <BaseInput
      v-for="field in deckFields"
      :key="field.id"
      v-model="fieldValues[field.id]"
      :label="fieldLabel(field.id)"
      :placeholder="field.required ? 'Обязательное поле' : 'Необязательное поле'"
      multiline
    />

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
