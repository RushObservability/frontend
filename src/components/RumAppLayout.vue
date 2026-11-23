<script setup lang="ts">
import { useRoute } from 'vue-router'

defineProps<{ appName: string }>()

const route = useRoute()
</script>

<template>
  <div class="rum">
    <header class="rum-header">
      <div class="rum-header-left">
        <RouterLink class="back-btn" :to="{ name: 'rum' }">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9 3L5 7l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          RUM
        </RouterLink>
        <div class="rum-title-block">
          <span class="rum-kicker">Real user monitoring</span>
          <h1 class="page-title">{{ appName }}</h1>
        </div>
      </div>
      <div v-if="$slots.controls" class="rum-header-controls">
        <slot name="controls" />
      </div>
    </header>
    <nav class="rum-page-nav" aria-label="RUM application">
      <RouterLink :to="{ name: 'rum-detail', params: { appName }, query: { t: route.query.t } }">Overview</RouterLink>
      <RouterLink :to="{ name: 'rum-cohorts', params: { appName }, query: { t: route.query.t } }">Returning users</RouterLink>
    </nav>
    <slot />
  </div>
</template>

<style scoped src="../styles/components/RumAppLayout.css"></style>
