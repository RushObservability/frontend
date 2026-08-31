<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  icon?: string
  tone?: 'neutral' | 'error' | 'loading'
  compact?: boolean
}>(), {
  description: '',
  icon: '◇',
  tone: 'neutral',
  compact: false,
})
</script>

<template>
  <div class="empty-state-block" :class="[`empty-state-block--${tone}`, { 'empty-state-block--compact': compact }]" :role="tone === 'error' ? 'alert' : 'status'">
    <span class="empty-state-block-icon" aria-hidden="true">{{ icon }}</span>
    <div class="empty-state-block-copy">
      <strong>{{ title }}</strong>
      <p v-if="description">{{ description }}</p>
    </div>
    <div v-if="$slots.action" class="empty-state-block-action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.empty-state-block { display: grid; justify-items: center; gap: 10px; padding: clamp(28px, 5vw, 52px) 24px; color: var(--text-secondary); text-align: center; }
.empty-state-block-icon { display: grid; place-items: center; width: 38px; height: 38px; color: var(--accent); background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 24%, transparent); border-radius: 11px; font-size: 17px; }
.empty-state-block-copy { display: grid; max-width: 440px; gap: 5px; }
.empty-state-block-copy strong { color: var(--text-primary); font-size: 14px; font-weight: 650; }
.empty-state-block-copy p { margin: 0; color: var(--text-muted); font-size: 12px; line-height: 1.55; }
.empty-state-block-action { margin-top: 3px; }
.empty-state-block--compact { grid-template-columns: auto minmax(0, 1fr) auto; justify-items: start; padding: 18px; text-align: left; }
.empty-state-block--compact .empty-state-block-icon { width: 32px; height: 32px; border-radius: 8px; }
.empty-state-block--error .empty-state-block-icon { color: var(--error); background: var(--error-dim); border-color: color-mix(in srgb, var(--error) 24%, transparent); }
.empty-state-block--loading .empty-state-block-icon { animation: empty-state-pulse 1.2s ease-in-out infinite; }
@keyframes empty-state-pulse { 50% { opacity: .45; transform: scale(.94); } }
@media (max-width: 520px) { .empty-state-block--compact { grid-template-columns: auto minmax(0, 1fr); } .empty-state-block--compact .empty-state-block-action { grid-column: 2; } }
@media (prefers-reduced-motion: reduce) { .empty-state-block--loading .empty-state-block-icon { animation: none; } }
</style>

