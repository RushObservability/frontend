<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import DataTable from '../DataTable.vue'
import type { LogPattern, TimeDomain } from '../../types'
import { eventLink, patternSpark } from '../../lib/dashboardPanels'

const props = defineProps<{ patterns: LogPattern[]; total: number; timeDomain?: TimeDomain }>()
const expanded = ref<number | null>(null)
watch(() => props.patterns, () => { expanded.value = null })
const rows = computed(() => props.patterns.map((pattern, id) => {
  const bins = patternSpark(pattern, props.timeDomain)
  return { ...pattern, id, bins, peak: Math.max(...bins, 1) }
}))
const columns = [
  { key: 'template', label: 'Pattern' }, { key: 'count', label: 'Events', align: 'right' as const },
  { key: 'share', label: 'Share', align: 'right' as const }, { key: 'volume', label: 'Volume' },
]
const severityColor = (level: unknown) => /ERROR|FATAL/i.test(String(level)) ? 'var(--error)' : /WARN/i.test(String(level)) ? 'var(--warning)' : 'var(--accent)'
</script>

<template>
  <div class="patterns-widget">
    <DataTable bare :columns="columns" :rows="rows" :expanded-row-key="expanded" row-key="id">
      <template #cell-template="{ row }">
        <button class="pattern-toggle" :aria-expanded="expanded === row.id" @click="expanded = expanded === row.id ? null : Number(row.id)">
          <span aria-hidden="true">{{ expanded === row.id ? '⌄' : '›' }}</span><i :style="{ background: severityColor(row.severity) }" />
          <span><code>{{ row.template }}</code><small>{{ row.service || 'unknown service' }} · {{ row.severity || 'unset severity' }}</small></span>
        </button>
      </template>
      <template #cell-share="{ row }">{{ total > 0 ? `${(Number(row.count) / total * 100).toFixed(1)}%` : '—' }}</template>
      <template #cell-volume="{ row }">
        <svg class="pattern-spark" viewBox="0 0 120 24" role="img" :aria-label="`${row.count} events over the selected range`">
          <rect v-for="(n, i) in (row.bins as number[])" :key="i" :x="i * 4" :y="24 - n / Number(row.peak) * 23" width="3" :height="n / Number(row.peak) * 23" :fill="severityColor(row.severity)" />
        </svg>
      </template>
      <template #row-detail="{ row }">
        <div class="pattern-example"><div><strong>Latest example</strong><span>{{ row.last_seen }}</span></div><code>{{ row.example }}</code>
          <RouterLink :to="eventLink({ trace_id: String(row.trace_id), span_id: '', service: String(row.service), timestamp: String(row.last_seen) }, 'logs', timeDomain)">Explore matching trace or service events →</RouterLink>
        </div>
      </template>
    </DataTable>
    <div class="patterns-summary">{{ patterns.length }} patterns shown · {{ total.toLocaleString() }} events in range<span>Numbers and UUIDs are normalized</span></div>
  </div>
</template>

<style scoped>
.patterns-widget { height: 100%; min-width: 0; overflow: auto; }
.pattern-toggle { display: flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: var(--text-primary); text-align: left; cursor: pointer; font: inherit; min-width: 220px; }
.pattern-toggle i { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 50%; }
.pattern-toggle code { display: block; white-space: normal; overflow-wrap: anywhere; font: 11px var(--font-mono); }
.pattern-toggle small { display: block; color: var(--text-muted); font-size: 10px; margin-top: 4px; }
.pattern-toggle:hover code { color: var(--accent); }
.pattern-spark { display: block; width: 120px; height: 24px; }
.pattern-example { padding: 10px 16px; white-space: normal; }
.pattern-example > div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; color: var(--text-muted); font-size: 11px; }
.pattern-example strong { font-weight: 500; }
.pattern-example code { display: block; padding: 10px 0; font: 11px var(--font-mono); overflow-wrap: anywhere; }
.pattern-example a { color: var(--accent); font-size: 11px; }
.patterns-summary { padding: 10px 16px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--border-subtle); color: var(--text-muted); font-size: 11px; }
</style>
