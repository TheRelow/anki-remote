<!-- src/components/DeckDetail.vue -->
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAnkiStore } from '../store/ankiStore'
import BaseInput from './BaseInput.vue'
import BaseButton from './BaseButton.vue'
import type { DeckFieldDefinition, DeckFieldType } from '../types'

const props = defineProps<{
  deckId?: string | null;
}>()

const store = useAnkiStore()
const deckName = ref('')
const schemaFields = ref<DeckFieldDefinition[]>([])

const FIELD_TYPE_OPTIONS: DeckFieldType[] = ['text', 'markdown', 'url', 'number']

function defaultFields(): DeckFieldDefinition[] {
  return [
    { id: 'front', type: 'text', required: true },
    { id: 'back', type: 'text', required: true },
  ]
}

function syncName() {
  if (props.deckId) {
    const deck = store.decks.find(d => d.id === props.deckId)
    if (deck) {
      deckName.value = deck.name
      schemaFields.value = deck.fieldSchema?.fields?.length
        ? deck.fieldSchema.fields.map((f) => ({ ...f }))
        : defaultFields()
    }
  } else {
    deckName.value = ''
    schemaFields.value = defaultFields()
  }
}

onMounted(syncName)
watch(() => [props.deckId, store.decks], syncName, { deep: true })

function addField(): void {
  schemaFields.value.push({
    id: '',
    type: 'text',
    required: false,
  })
}

function isCoreField(fieldId: string): boolean {
  const id = fieldId.trim().toLowerCase()
  return id === 'front' || id === 'back'
}

function removeField(index: number): void {
  const field = schemaFields.value[index]
  if (!field) return
  if (isCoreField(field.id)) return
  schemaFields.value.splice(index, 1)
}

function normalizeFields(): DeckFieldDefinition[] {
  const uniq = new Set<string>()
  const out: DeckFieldDefinition[] = []
  for (const field of schemaFields.value) {
    const id = field.id.trim()
    if (!id || uniq.has(id)) continue
    uniq.add(id)
    out.push({
      id,
      type: FIELD_TYPE_OPTIONS.includes(field.type) ? field.type : 'text',
      required: !!field.required,
    })
  }

  if (!out.some((field) => field.id === 'front')) {
    out.unshift({ id: 'front', type: 'text', required: true })
  }
  if (!out.some((field) => field.id === 'back')) {
    out.push({ id: 'back', type: 'text', required: true })
  }

  return out
}

async function save() {
  if (!deckName.value.trim()) return
  const fields = normalizeFields()
  if (fields.length === 0) {
    alert('Добавьте хотя бы одно поле колоды')
    return
  }
  const fieldSchema = { version: 1, fields }

  try {
    if (props.deckId) {
      await store.updateDeck(props.deckId, { name: deckName.value.trim(), fieldSchema })
    } else {
      await store.addDeck(deckName.value.trim(), fieldSchema)
    }
    deckName.value = ''
    schemaFields.value = defaultFields()
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

    <div class="deck-schema">
      <div class="deck-schema__header">
        <strong>Поля карточки</strong>
        <BaseButton variant="secondary" @click="addField">Добавить поле</BaseButton>
      </div>

      <div v-for="(field, idx) in schemaFields" :key="`field-${idx}`" class="deck-schema__row">
        <BaseInput
          v-model="field.id"
          label="ID поля"
          placeholder="Например: exampleSentence"
        />
        <label class="deck-schema__control">
          <span>Тип</span>
          <select v-model="field.type" class="deck-schema__select">
            <option v-for="t in FIELD_TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
          </select>
        </label>
        <label class="deck-schema__checkbox">
          <input v-model="field.required" type="checkbox" />
          Обязательное
        </label>
        <BaseButton
          variant="danger"
          v-if="!isCoreField(field.id)"
          @click="removeField(idx)"
        >
          Удалить
        </BaseButton>
      </div>
    </div>

    <BaseButton block @click="save" style="margin-top: 15px;">
      {{ props.deckId ? 'Сохранить изменения' : 'Создать колоду' }}
    </BaseButton>
  </div>
</template>

<style scoped lang="scss">
.deck-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.deck-schema {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--anki-gray);
  border-radius: 8px;
}

.deck-schema__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.deck-schema__row {
  display: grid;
  grid-template-columns: 1fr 140px 130px 100px;
  gap: 10px;
  align-items: end;
}

.deck-schema__control {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.85rem;
  color: var(--anki-text-muted);
}

.deck-schema__select {
  padding: 10px 12px;
  border: 1px solid var(--anki-gray);
  border-radius: 8px;
  font-size: 0.95rem;
}

.deck-schema__checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
}
</style>
