<script setup lang="ts">
import { useId } from 'vue'
import type { PanelTone, PanelVariant } from './panels/types'

withDefaults(defineProps<{
  /** Short, scannable panel title. */
  title: string
  /** Longer explanation shown from the accessible info control. */
  description?: string
  /** Optional visible explanation beneath the visualization. */
  caption?: string
  /** Data source shown in the footer, for example "Metrics" or "Spans + Logs". */
  sourceLabel?: string
  /** Compact time-range context shown in the header, for example "6h". */
  rangeLabel?: string
  /** Kept for backwards compatibility; visualization components render units. */
  unit?: string
  /** Loading panels retain their final structure to avoid layout jumps. */
  loading?: boolean
  /** Compact, isolated panel error. */
  error?: string | null
  /** Explicit empty state for complete panel components. */
  empty?: boolean
  emptyTitle?: string
  emptyMessage?: string
  /** Visual treatment selected by the composed panel component. */
  variant?: PanelVariant
  tone?: PanelTone
}>(), {
  description: '',
  caption: '',
  sourceLabel: '',
  rangeLabel: '',
  unit: '',
  loading: false,
  error: null,
  empty: false,
  emptyTitle: 'No data yet',
  emptyMessage: 'Try a wider time range or adjust this panel’s query.',
  variant: 'chart',
  tone: 'default',
})

const panelId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const titleId = `panel-${panelId}-title`
const descriptionId = `panel-${panelId}-description`
</script>

<template>
  <section
    class="panel-card"
    :class="[`panel-card--${variant}`, `panel-card--${tone}`]"
    :aria-labelledby="titleId"
    :aria-busy="loading || undefined"
  >
    <header class="panel-header">
      <div class="panel-header-left">
        <h2 :id="titleId" class="panel-title" :title="title">{{ title }}</h2>
        <button
          v-if="description"
          type="button"
          class="panel-info"
          :aria-label="`About ${title}`"
          :aria-describedby="descriptionId"
          @click.stop
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25" />
            <circle cx="8" cy="5.1" r="0.95" fill="currentColor" />
            <rect x="7.25" y="7" width="1.5" height="4.4" rx="0.6" fill="currentColor" />
          </svg>
          <span :id="descriptionId" class="panel-info-tip" role="tooltip">{{ description }}</span>
        </button>
      </div>
      <div class="panel-header-right">
        <span v-if="rangeLabel" class="panel-range mono">{{ rangeLabel }}</span>
        <slot name="actions" />
      </div>
    </header>

    <div v-if="$slots.summary && !loading && !error && !empty" class="panel-summary">
      <slot name="summary" />
    </div>

    <div class="panel-body">
      <div v-if="loading" class="panel-loading" role="status">
        <span class="sr-only">Loading {{ title }}</span>
        <span class="panel-loading-line panel-loading-line--short"></span>
        <span class="panel-loading-chart"></span>
        <span class="panel-loading-line"></span>
      </div>
      <div v-else-if="error" class="panel-error" role="alert">
        <span class="panel-error-icon">!</span>
        <span class="panel-error-copy">
          <strong>Panel unavailable</strong>
          <span class="panel-error-msg">{{ error }}</span>
        </span>
      </div>
      <div v-else-if="empty" class="panel-empty">
        <span class="panel-empty-mark" aria-hidden="true">—</span>
        <strong>{{ emptyTitle }}</strong>
        <span>{{ emptyMessage }}</span>
      </div>
      <slot v-else />
    </div>

    <div v-if="$slots.legend && !loading && !error && !empty" class="panel-legend">
      <slot name="legend" />
    </div>

    <footer v-if="(caption || sourceLabel || $slots.footer) && !loading" class="panel-footer">
      <p v-if="caption" class="panel-caption">{{ caption }}</p>
      <span v-if="sourceLabel" class="panel-source mono">{{ sourceLabel }}</span>
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped src="../styles/components/PanelCard.css"></style>
