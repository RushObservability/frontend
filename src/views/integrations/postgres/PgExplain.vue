<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../../../composables/useApi'
import PgPlanTree from './PgPlanTree.vue'

const props = defineProps<{ server?: string }>()
const api = useApi()
const route = useRoute()

const query = ref('')
const running = ref(false)
const error = ref('')
const status = ref('')
const plan = ref<any | null>(null)
const rawJson = ref('')
const showRaw = ref(false)

// Walk the plan tree into a flat list for insights.
function walk(n: any, acc: any[]) {
  if (!n) return
  acc.push(n)
  for (const c of n['Plans'] || []) walk(c, acc)
}
const insights = computed<string[]>(() => {
  if (!plan.value) return []
  const nodes: any[] = []
  walk(plan.value, nodes)
  const out: string[] = []
  const seqScans = nodes.filter((n) => n['Node Type'] === 'Seq Scan' && (n['Plan Rows'] ?? 0) > 1000)
  for (const s of seqScans) out.push(`Sequential scan on ${s['Relation Name']} (~${(s['Plan Rows'] ?? 0).toLocaleString()} rows) — consider an index.`)
  const top = nodes.reduce((m, n) => ((n['Total Cost'] ?? 0) > (m?.['Total Cost'] ?? -1) ? n : m), null as any)
  if (top) out.push(`Most expensive node: ${top['Node Type']}${top['Relation Name'] ? ' on ' + top['Relation Name'] : ''} (cost ${(top['Total Cost'] ?? 0).toLocaleString()}).`)
  const nl = nodes.filter((n) => n['Node Type'] === 'Nested Loop').length
  if (nl) out.push(`${nl} nested loop${nl > 1 ? 's' : ''} — verify the inner side is well-indexed for large inputs.`)
  return out
})
const rootCost = computed(() => plan.value?.['Total Cost'] ?? 0)

async function run() {
  if (!query.value.trim() || running.value) return
  running.value = true
  error.value = ''
  status.value = 'submitting'
  plan.value = null
  rawJson.value = ''
  try {
    const { id } = await api.submitExplain(props.server || '', query.value)
    status.value = 'queued'
    // Poll until the collector runs it (or it errors).
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const job = await api.getExplainJob(id)
      status.value = job.status
      if (job.status === 'done') {
        rawJson.value = job.plan_json
        const parsed = JSON.parse(job.plan_json)
        plan.value = Array.isArray(parsed) ? parsed[0]?.Plan : parsed?.Plan
        break
      }
      if (job.status === 'error') {
        error.value = job.error || 'EXPLAIN failed'
        break
      }
    }
    if (!plan.value && !error.value) error.value = 'Timed out waiting for the collector to run EXPLAIN.'
  } catch (e: any) {
    error.value = e?.message || 'Failed to submit'
  } finally {
    running.value = false
  }
}

onMounted(() => {
  const q = route.query.q
  if (typeof q === 'string' && q) query.value = q
})
</script>

<template>
  <div class="pg-explain">
    <p class="hint">
      Run <code>EXPLAIN (FORMAT JSON)</code> on a query (estimates only — the query is not
      executed). Replace any <code>$1</code> placeholders with literal values.
    </p>
    <textarea
      v-model="query"
      class="explain-input"
      spellcheck="false"
      placeholder="SELECT * FROM your_table WHERE col = 'value' LIMIT 50"
    ></textarea>
    <div class="explain-actions">
      <button class="btn btn-primary" :disabled="running || !query.trim()" @click="run">
        {{ running ? 'Running…' : 'Run EXPLAIN' }}
      </button>
      <span v-if="running" class="status">{{ status }}…</span>
      <span v-if="showRaw !== undefined && plan" class="raw-toggle" @click="showRaw = !showRaw">
        {{ showRaw ? 'Hide' : 'Show' }} raw JSON
      </span>
    </div>

    <p v-if="error" class="explain-error">{{ error }}</p>

    <template v-if="plan">
      <div v-if="insights.length" class="insights">
        <div class="insights-title">Insights</div>
        <ul><li v-for="(it, i) in insights" :key="i">{{ it }}</li></ul>
      </div>
      <div class="plan-wrap">
        <PgPlanTree :node="plan" :max-cost="rootCost" />
      </div>
      <pre v-if="showRaw" class="raw">{{ rawJson }}</pre>
    </template>
  </div>
</template>

<style scoped>
.pg-explain { max-width: 1000px; }
.hint { font-size: 12.5px; color: var(--text-tertiary); margin: 0 0 10px; }
.hint code { font-family: var(--font-mono, monospace); color: var(--text-secondary); }
.explain-input {
  width: 100%; min-height: 120px; resize: vertical;
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; line-height: 1.5;
  color: var(--text-primary); background: var(--bg-surface);
  border: 1px solid var(--border-subtle); border-radius: var(--r-sm, 4px);
  padding: 12px; box-sizing: border-box;
}
.explain-input:focus { outline: none; border-color: var(--amber, #f59e0b); }
.explain-actions { display: flex; align-items: center; gap: 14px; margin: 12px 0; }
.status { font-size: 12px; color: var(--text-tertiary); text-transform: capitalize; }
.raw-toggle { font-size: 12px; color: var(--text-secondary); cursor: pointer; margin-left: auto; }
.raw-toggle:hover { color: var(--amber, #f59e0b); }
.explain-error { color: var(--error, #ef4444); font-size: 13px; font-family: var(--font-mono, monospace); white-space: pre-wrap; }
.insights {
  border: 1px solid var(--border-subtle); border-left: 2px solid var(--amber, #f59e0b);
  border-radius: var(--r-md, 8px); padding: 12px 16px; margin-bottom: 16px;
  background: color-mix(in srgb, var(--amber, #f59e0b) 4%, var(--bg-surface));
}
.insights-title { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; margin-bottom: 6px; }
.insights ul { margin: 0; padding-left: 18px; }
.insights li { font-size: 13px; color: var(--text-secondary); margin: 3px 0; }
.plan-wrap { margin-top: 4px; }
.raw {
  margin-top: 14px; padding: 12px; max-height: 320px; overflow: auto;
  font-family: var(--font-mono, monospace); font-size: 11.5px; color: var(--text-secondary);
  background: var(--bg-hover); border-radius: var(--r-sm, 4px);
}
</style>
