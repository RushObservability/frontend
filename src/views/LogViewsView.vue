<script setup lang="ts">
import LogViewsSettings from './settings/LogViewsSettings.vue'
</script>

<template>
  <main class="log-views-page">
    <header>
      <div><h1>Log views</h1><p>Manage your personal views and browse shared views for a tenant.</p></div>
      <router-link to="/?mode=logs">Back to Explore</router-link>
    </header>
    <LogViewsSettings />
  </main>
</template>

<style scoped>
.log-views-page { padding: var(--sp-6); min-width: 0; }
header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-4); margin-bottom: var(--sp-6); }
h1 { margin: 0; font-size: 20px; font-weight: 600; color: var(--text-primary); }
p { font-size: 12px; color: var(--text-secondary); }
a { font-size: 12px; color: var(--accent); white-space: nowrap; }
@media (max-width: 600px) { header { flex-direction: column; } .log-views-page { padding: var(--sp-4); } }
</style>
