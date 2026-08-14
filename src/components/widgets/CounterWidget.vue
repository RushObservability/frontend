<script setup lang="ts">
defineProps<{
  value: number
  label?: string
}>()

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}
</script>

<template>
  <div class="counter-widget">
    <div class="counter-value mono">{{ formatCount(value) }}</div>
    <div v-if="label" class="counter-label">{{ label }}</div>
  </div>
</template>

<style scoped src="../../styles/widgets/CounterWidget.css"></style>
