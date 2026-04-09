<!-- src/App.vue -->
<script setup lang="ts">
import AnkiWidget from './components/AnkiWidget.vue'
</script>

<template>
  <!-- Представь, что этот div — это чужой сайт, куда ты встраиваешься -->
  <div style="background-color: #f0f0f0; padding: 50px; min-height: 100vh;">
    <h1>Тестовый стенд</h1>

    <!-- Вот ты вставил свое приложение -->
    <div class="app-wrapper">
      <AnkiWidget />
    </div>
  </div>
</template>

<style scoped lang="scss">
.app-wrapper {
  border: 5px solid #ccc;
  border-radius: 8px;
}
</style>