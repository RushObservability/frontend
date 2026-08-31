<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatKubectlFallback, formatKubectlResult } from '../lib/kubernetesResult'

type ResultView = 'kubectl' | 'json'

const props = defineProps<{
  value: unknown
  resource?: string
  namespace?: string
}>()

const activeView = ref<ResultView>('kubectl')
const table = computed(() => formatKubectlResult(props.value, {
  resource: props.resource,
  namespace: props.namespace,
}))
const fallback = computed(() => formatKubectlFallback(props.value))

const jsonText = computed(() => {
  if (props.value == null || props.value === '') return 'No result body was stored.'
  if (typeof props.value === 'string') {
    try { return JSON.stringify(JSON.parse(props.value), null, 2) } catch { return props.value }
  }
  try { return JSON.stringify(props.value, null, 2) } catch { return String(props.value) }
})

const resultCount = computed(() => table.value?.rows.length || 0)
</script>

<template>
  <div class="kubernetes-result-viewer">
    <div class="result-viewer-head">
      <div class="result-viewer-title">
        <span>Command result</span>
        <small v-if="table">{{ resultCount.toLocaleString() }} {{ table.resourceLabel }}</small>
        <slot name="meta" />
      </div>
      <div class="result-view-toggle" role="group" aria-label="Command result format">
        <button
          type="button"
          :class="{ active: activeView === 'kubectl' }"
          :aria-pressed="activeView === 'kubectl'"
          @click="activeView = 'kubectl'"
        >
          kubectl
        </button>
        <button
          type="button"
          :class="{ active: activeView === 'json' }"
          :aria-pressed="activeView === 'json'"
          @click="activeView = 'json'"
        >
          JSON
        </button>
      </div>
    </div>

    <div v-if="activeView === 'kubectl'" class="kubectl-result" aria-live="polite">
      <div
        v-if="table && table.rows.length"
        class="kubectl-table-scroll"
        role="region"
        aria-label="kubectl-style command result"
        tabindex="0"
      >
        <table>
          <caption class="sr-only">kubectl-style command result</caption>
          <thead>
            <tr>
              <th
                v-for="column in table.columns"
                :key="column.key"
                scope="col"
                :class="{ 'cell-number': column.align === 'right' }"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in table.rows" :key="rowIndex">
              <td
                v-for="(cell, columnIndex) in row"
                :key="`${rowIndex}-${table.columns[columnIndex]?.key || columnIndex}`"
                :class="{ 'cell-number': table.columns[columnIndex]?.align === 'right' }"
              >
                {{ cell }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else-if="table" class="result-empty">
        <strong>No resources found.</strong>
        <span>The command returned an empty list.</span>
      </div>
      <pre
        v-else-if="fallback.output"
        class="kubectl-message"
        :class="{ 'kubectl-message--error': fallback.tone === 'error' }"
      >{{ fallback.output }}</pre>
      <div v-else class="result-empty">
        <strong>{{ fallback.title }}</strong>
        <span v-if="fallback.detail">{{ fallback.detail }}</span>
      </div>
    </div>

    <pre v-else class="result-json" aria-label="Command result JSON">{{ jsonText }}</pre>
  </div>
</template>

<style scoped>
.kubernetes-result-viewer {
  min-width: 0;
  overflow: hidden;
  background: var(--bg-void);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  container-type: inline-size;
}

.result-viewer-head {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: 5px 7px 5px 10px;
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border-subtle);
}

.result-viewer-title {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 650;
}

.result-viewer-title small {
  color: var(--text-muted);
  font: 8px var(--font-mono);
}

.result-view-toggle {
  display: inline-grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 2px;
  background: var(--bg-overlay);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
}

.result-view-toggle button {
  min-height: 24px;
  padding: 3px 8px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 2px;
  font: 600 8px var(--font-mono);
  cursor: pointer;
}

.result-view-toggle button:hover { color: var(--text-primary); }
.result-view-toggle button.active { color: var(--amber); background: var(--amber-dim); }
.result-view-toggle button:focus-visible { outline: 1px solid var(--amber); outline-offset: 1px; }

.kubectl-table-scroll {
  max-height: 420px;
  overflow: auto;
  scrollbar-color: var(--border-strong) transparent;
}

table {
  width: 100%;
  border-collapse: collapse;
  color: var(--text-primary);
  font: 9px/1.45 var(--font-mono);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

th,
td {
  padding: 7px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
}

th {
  position: sticky;
  z-index: 1;
  top: 0;
  color: var(--text-muted);
  background: var(--bg-overlay);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: .04em;
}

tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: var(--bg-hover); }
.cell-number { text-align: right; }

.kubectl-message,
.result-json {
  min-height: 180px;
  max-height: 420px;
  margin: 0;
  overflow: auto;
  padding: 12px;
  color: var(--text-primary);
  background: var(--bg-void);
  font: 9px/1.55 var(--font-mono);
  tab-size: 2;
  white-space: pre;
}

.kubectl-message {
  min-height: 110px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.kubectl-message--error { color: var(--error); }

.result-empty {
  display: grid;
  min-height: 150px;
  place-content: center;
  justify-items: center;
  gap: 4px;
  padding: var(--sp-5);
  color: var(--text-muted);
  text-align: center;
}

.result-empty strong { color: var(--text-secondary); font-size: 11px; }
.result-empty span { font-size: 10px; }

@container (max-width: 360px) {
  .result-viewer-head { align-items: stretch; flex-direction: column; }
  .result-view-toggle { width: 100%; }
}
</style>
