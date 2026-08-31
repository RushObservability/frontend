<script setup lang="ts">
defineProps<{
  apmEnabled: boolean
  viewMode: 'spans' | 'logs'
  live: boolean
  shareCopied: boolean
}>()

const emit = defineEmits<{
  setMode: [mode: 'spans' | 'logs']
  toggleLive: []
  export: []
  share: []
  showShortcuts: []
}>()
</script>

<template>
  <div class="explore-toolbar">
    <div class="explore-toolbar-mode">
      <div v-if="apmEnabled" class="explore-mode-toggle" role="group" aria-label="Signal type">
        <button type="button" :class="{ active: viewMode === 'spans' }" :aria-pressed="viewMode === 'spans'" @click="emit('setMode', 'spans')">APM</button>
        <button type="button" :class="{ active: viewMode === 'logs' }" :aria-pressed="viewMode === 'logs'" @click="emit('setMode', 'logs')">Logs</button>
      </div>
    </div>
    <div class="explore-toolbar-actions">
      <slot name="time" />
      <button type="button" class="explore-live-button" :class="{ active: live }" :aria-pressed="live" @click="emit('toggleLive')">
        <span aria-hidden="true"></span> Live
      </button>
      <button type="button" class="explore-toolbar-button" @click="emit('export')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Export
      </button>
      <slot name="saved" />
      <button type="button" class="explore-toolbar-button" @click="emit('share')">
        <span aria-hidden="true">↗</span>{{ shareCopied ? 'Copied' : 'Share' }}
      </button>
      <slot name="history" />
      <button type="button" class="explore-shortcuts-button" aria-label="View keyboard shortcuts" @click="emit('showShortcuts')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.explore-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.explore-toolbar-mode, .explore-toolbar-actions { display: flex; align-items: center; gap: 8px; }
.explore-toolbar-actions { justify-content: flex-end; min-width: 0; flex-wrap: wrap; }
.explore-mode-toggle { display: flex; gap: 2px; padding: 2px; background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: 5px; }
.explore-mode-toggle button { min-height: 28px; padding: 0 12px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 3px; font-size: 11px; font-weight: 650; }
.explore-mode-toggle button:hover { color: var(--text-primary); background: var(--bg-hover); }
.explore-mode-toggle button.active { color: var(--accent); background: var(--accent-soft); }
.explore-live-button, .explore-toolbar-button, .explore-shortcuts-button { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: 5px; font-size: 11px; font-weight: 600; white-space: nowrap; }
.explore-live-button:hover, .explore-toolbar-button:hover, .explore-shortcuts-button:hover { color: var(--accent); border-color: var(--accent-muted); }
.explore-live-button > span { width: 6px; height: 6px; background: var(--text-muted); border-radius: 50%; }
.explore-live-button.active { color: var(--ok); background: var(--ok-dim); border-color: color-mix(in srgb, var(--ok) 55%, transparent); }
.explore-live-button.active > span { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-dim); }
.explore-toolbar-button svg, .explore-shortcuts-button svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.explore-shortcuts-button { width: 32px; padding: 0; }

@media (max-width: 860px) {
  .explore-toolbar { align-items: stretch; flex-direction: column; }
  .explore-toolbar-mode { justify-content: flex-start; }
  .explore-toolbar-actions { justify-content: flex-start; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 4px; scrollbar-width: thin; }
  .explore-toolbar-actions > :deep(*) { flex: 0 0 auto; }
}

@media (prefers-reduced-motion: reduce) {
  .explore-live-button.active > span { box-shadow: none; }
}
</style>

