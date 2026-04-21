<!-- src/components/BaseButton.vue -->
<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  block?: boolean; // Делает кнопку на всю ширину (100%)
}>(), {
  variant: 'primary',
  block: false
})

const buttonClasses = computed(() => {
  return [
    'base-button',
    `base-button--${props.variant}`,
    { 'base-button--block': props.block }
  ]
})
</script>

<template>
  <button :class="buttonClasses" type="button">
    <slot></slot>
  </button>
</template>

<style scoped lang="scss">
.base-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  padding: 12px 20px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: var(--anki-radius);
  cursor: pointer;
  transition: var(--anki-transition);

  /* Эффект нажатия */
  &:active {
    transform: scale(0.97);
  }

  &--block {
    width: 100%;
  }

  /* Варианты цветов */
  &--primary {
    background-color: var(--anki-primary);
    color: white;
    &:hover { background-color: var(--anki-primary-hover); }
  }

  &--secondary {
    background-color: var(--anki-gray);
    color: var(--anki-text-main);
    &:hover { background-color: var(--anki-gray-hover); }
  }

  &--success {
    background-color: var(--anki-success);
    color: white;
    &:hover { background-color: var(--anki-success-hover); }
  }

  &--warning {
    background-color: var(--anki-warning);
    color: white;
    &:hover { background-color: var(--anki-warning-hover); }
  }

  &--danger {
    background-color: var(--anki-danger);
    color: white;
    &:hover { background-color: var(--anki-danger-hover); }
  }
}
</style>