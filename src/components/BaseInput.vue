<!-- src/components/BaseInput.vue -->
<script setup lang="ts">
// defineModel - фича Vue 3.4+. Автоматически прокидывает v-model
const model = defineModel<string>()

withDefaults(defineProps<{
  label?: string;
  placeholder?: string;
  multiline?: boolean; // Если true - рисуем textarea
}>(), {
  multiline: false
})
</script>

<template>
  <div class="base-input-wrapper">
    <label v-if="label" class="base-input__label">{{ label }}</label>

    <textarea
      v-if="multiline"
      v-model="model"
      class="base-input__field base-input__field--textarea"
      :placeholder="placeholder"
      rows="3"
    ></textarea>

    <input
      v-else
      v-model="model"
      type="text"
      class="base-input__field"
      :placeholder="placeholder"
    />
  </div>
</template>

<style scoped lang="scss">
.base-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.base-input__label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--anki-text-muted);
}

.base-input__field {
  padding: 10px 12px;
  border: 1px solid var(--anki-gray);
  border-radius: 8px;
  font-size: 1rem;
  font-family: inherit;
  transition: border-color 0.2s;
  outline: none;

  &:focus {
    border-color: var(--anki-primary);
  }

  &--textarea {
    resize: vertical; /* Позволяет тянуть только вниз */
  }
}
</style>