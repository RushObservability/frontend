<script setup lang="ts">
defineProps<{
  value: number
  label?: string
  unit?: string
  tone?: 'default' | 'positive' | 'warning' | 'danger'
  precision?: number
}>()

function formatCount(n: number, precision?: number): string {
  if (precision !== undefined) {
    const digits = Math.max(0, Math.min(6, Math.trunc(precision)))
    return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
</script>

<template>
  <output class="counter-widget" :class="`counter-widget--${tone || 'default'}`" :aria-label="`${label || 'Current value'}: ${formatCount(value, precision)}${unit || ''}`">
    <div class="counter-value mono">
      {{ formatCount(value, precision) }}<small v-if="unit" class="counter-unit">{{ unit }}</small>
    </div>
    <div v-if="label" class="counter-label">{{ label }}</div>
  </output>
</template>

<style scoped src="../../styles/widgets/CounterWidget.css"></style>
