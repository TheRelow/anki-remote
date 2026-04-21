<script setup lang="ts">
import AnkiWidget from './components/AnkiWidget.vue'

const devToken = import.meta.env.VITE_ANKI_DEV_TOKEN?.trim() || undefined
</script>

<template>
  <div style="background-color: #f0f0f0; padding: 50px; min-height: calc(100vh - 100px);">
    <h1>Тестовый стенд</h1>

    <div class="test-block">
      <AnkiWidget :auth-token="devToken" />
    </div>

    <div class="test-block">
      <AnkiWidget mode="training-only" :auth-token="devToken" target-deck-id="all" :limit="10" />
    </div>
  </div>
</template>