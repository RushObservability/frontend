<script setup lang="ts">
defineProps<{
  /** Panel title — shown in the slim header (13px, weight 600). */
  title: string
  /** Optional one-line description — surfaced via an ⓘ info button + tooltip. */
  description?: string
  /** Optional unit (e.g. "req/s", "ms"). Not shown in the header; passed through
   *  to the chart for axis ticks, legend last-value, and the crosshair tooltip. */
  unit?: string
  /** Loading → subtle shimmer/spinner in the body. */
  loading?: boolean
  /** Error → compact error message row in the body. */
  error?: string | null
}>()
</script>

<template>
  <div class="panel-card">
    <div class="panel-header">
      <div class="panel-header-left">
        <span class="panel-title" :title="title">{{ title }}</span>
        <span v-if="description" class="panel-info" tabindex="0" :aria-label="description">
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
            <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25" />
            <circle cx="8" cy="5.1" r="0.95" fill="currentColor" />
            <rect x="7.25" y="7" width="1.5" height="4.4" rx="0.6" fill="currentColor" />
          </svg>
          <span class="panel-info-tip" role="tooltip">{{ description }}</span>
        </span>
      </div>
      <div class="panel-header-right">
        <slot name="actions" />
      </div>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="panel-loading">
        <div class="panel-spinner" aria-label="Loading"></div>
      </div>
      <div v-else-if="error" class="panel-error" role="alert">
        <span class="panel-error-icon">!</span>
        <span class="panel-error-msg">{{ error }}</span>
      </div>
      <slot v-else />
    </div>

    <div v-if="$slots.legend && !loading && !error" class="panel-legend">
      <slot name="legend" />
    </div>
  </div>
</template>

<style scoped src="../styles/components/PanelCard.css"></style>
