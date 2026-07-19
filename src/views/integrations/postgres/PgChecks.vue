<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { Filter, LogRecord, PromVectorResponse } from '../../../types'

const props = defineProps<{ server?: string }>()
const api = useApi()
const loading = ref(false)

type Severity = 'ok' | 'info' | 'warn' | 'critical'
interface Check { id: string; title: string; severity: Severity; summary: string; items: string[] }
const checks = ref<Check[]>([])

function sel(): string {
  return props.server ? `{service_name="${props.server}"}` : ''
}
async function fetchMap(metric: string, keyLabels: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  try {
    const r: PromVectorResponse = await api.promQuery(`${metric}${sel()}`)
    for (const s of r.result) {
      out[keyLabels.map((l) => s.metric[l] ?? '').join('|')] = parseFloat(s.value?.[1] ?? '0') || 0
    }
  } catch { /* ignore */ }
  return out
}
async function scalar(promql: string): Promise<number> {
  try {
    const r = await api.promQuery(`${promql}`)
    return r.result.reduce((a, s) => a + (parseFloat(s.value?.[1] ?? '0') || 0), 0)
  } catch { return NaN }
}

function fmtBytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

async function load() {
  loading.value = true
  const tk = ['schema', 'table']
  const [idxScans, idxSize, seq, idxT, live, dead, dbXid] = await Promise.all([
    fetchMap('postgresql_index_scans', ['schema', 'table', 'index']),
    fetchMap('postgresql_index_size', ['schema', 'table', 'index']),
    fetchMap('postgresql_table_seq_scans', tk),
    fetchMap('postgresql_table_idx_scans', tk),
    fetchMap('postgresql_table_live_rows', tk),
    fetchMap('postgresql_table_dead_rows', tk),
    scalar(`max(postgresql_database_xid_age${sel()})`),
  ])

  const out: Check[] = []

  // 1. Unused indexes
  // Exclude *_pkey — primary-key indexes back constraints and must not be dropped.
  const unused = Object.keys(idxScans).filter(
    (k) => idxScans[k] === 0 && (idxSize[k] ?? 0) > 0 && !/_pkey$/.test(k.split('|')[2] ?? ''),
  )
  const unusedBytes = unused.reduce((a, k) => a + (idxSize[k] ?? 0), 0)
  out.push({
    id: 'unused-indexes',
    title: 'Unused indexes',
    severity: unused.length ? 'warn' : 'ok',
      summary: unused.length
      ? `${unused.length} index(es) have no scans since the last reset, using ${fmtBytes(unusedBytes)}. Review before changing.`
      : 'No indexes are currently candidates for review.',
    items: unused.slice(0, 15).map((k) => { const [s, t, i] = k.split('|'); return `${i} on ${s}.${t} (${fmtBytes(idxSize[k] ?? 0)})` }),
  })

  // 2. Tables needing vacuum (dead-row %)
  const needVac: string[] = []
  for (const k of Object.keys(dead)) {
    const total = (live[k] ?? 0) + (dead[k] ?? 0)
    const pct = total > 0 ? ((dead[k] ?? 0) / total) * 100 : 0
    if (pct >= 20 && total > 1000) { const [s, t] = k.split('|'); needVac.push(`${s}.${t} — ${pct.toFixed(0)}% dead`) }
  }
  out.push({
    id: 'vacuum',
    title: 'Tables needing vacuum',
    severity: needVac.length ? 'warn' : 'ok',
    summary: needVac.length ? `${needVac.length} table(s) above 20% dead rows.` : 'No tables with high dead-row ratios.',
    items: needVac.slice(0, 15),
  })

  // 3. Cache hit ratio
  const h = await scalar(`sum(postgresql_blocks_read{source="hit"${props.server ? `,service_name="${props.server}"` : ''}})`)
  const rd = await scalar(`sum(postgresql_blocks_read{source="read"${props.server ? `,service_name="${props.server}"` : ''}})`)
  const ratio = h + rd > 0 ? (h / (h + rd)) * 100 : NaN
  out.push({
    id: 'cache-hit',
    title: 'Cache hit ratio',
    severity: !isFinite(ratio) ? 'info' : ratio >= 99 ? 'ok' : ratio >= 95 ? 'warn' : 'critical',
    summary: isFinite(ratio) ? `${ratio.toFixed(2)}% of block reads served from cache (target ≥ 99%).` : 'No data.',
    items: [],
  })

  // 4. High sequential scans
  const seqHeavy: string[] = []
  for (const k of Object.keys(seq)) {
    if ((seq[k] ?? 0) > 50 && (live[k] ?? 0) > 1000 && (seq[k] ?? 0) > (idxT[k] ?? 0)) {
      const [s, t] = k.split('|'); seqHeavy.push(`${s}.${t} — ${Math.round(seq[k] ?? 0).toLocaleString()} seq scans`)
    }
  }
  out.push({
    id: 'seq-scans',
    title: 'Tables read by sequential scan',
    severity: seqHeavy.length ? 'info' : 'ok',
    summary: seqHeavy.length ? `${seqHeavy.length} sizable table(s) read mostly via seq scans — see the Indexes tab.` : 'No sequential-scan-heavy tables.',
    items: seqHeavy.slice(0, 15),
  })

  // 5. XID wraparound risk (autovacuum_freeze_max_age default 200M; danger ~2.1B)
  out.push({
    id: 'wraparound',
    title: 'Transaction-ID wraparound risk',
    severity: !isFinite(dbXid) ? 'info' : dbXid >= 1_500_000_000 ? 'critical' : dbXid >= 1_000_000_000 ? 'warn' : 'ok',
    summary: isFinite(dbXid) ? `Oldest database XID age is ${Math.round(dbXid).toLocaleString()} (wraparound at ~2.1B).` : 'No data.',
    items: [],
  })

  // 6. Tables without a primary key (heuristic: no *_pkey index in latest schema snapshot)
  const filters: Filter[] = [{ field: 'log.event', op: '=', value: 'postgresql.schema.table' }]
  if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
  const noPk: string[] = []
  try {
    const res = await api.queryLogs({
      time_range: { from: new Date(Date.now() - 3600_000).toISOString(), to: new Date().toISOString() },
      filters, limit: 2000,
    })
    const seen = new Set<string>()
    for (const r of res.rows as LogRecord[]) {
      const key = `${r.LogAttributes['schema']}.${r.LogAttributes['table']}`
      if (seen.has(key)) continue
      seen.add(key)
      let idxs: Array<{ name: string; def: string }> = []
      try { idxs = JSON.parse(r.LogAttributes['indexes'] || '[]') } catch { /* */ }
      const hasPk = idxs.some((ix) => /_pkey$/.test(ix.name) || /PRIMARY KEY/i.test(ix.def))
      if (!hasPk) noPk.push(key)
    }
  } catch { /* */ }
  out.push({
    id: 'no-pk',
    title: 'Tables without a primary key',
    severity: noPk.length ? 'warn' : 'ok',
    summary: noPk.length ? `${noPk.length} table(s) appear to lack a primary key (heuristic).` : 'All tables have a primary key.',
    items: noPk.slice(0, 15),
  })

  checks.value = out
  loading.value = false
}

onMounted(load)
watch(() => props.server, load)

// ── Presentation: rank worst-first, tally, overall verdict ──
const RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 }
const GLYPH: Record<Severity, string> = { critical: '✕', warn: '!', info: 'i', ok: '✓' }
const sortedChecks = computed(() =>
  [...checks.value].sort((a, b) => RANK[a.severity] - RANK[b.severity]),
)
const counts = computed(() => {
  const c: Record<Severity, number> = { ok: 0, info: 0, warn: 0, critical: 0 }
  for (const x of checks.value) c[x.severity]++
  return c
})
const worst = computed<Severity>(() =>
  checks.value.reduce<Severity>((w, x) => (RANK[x.severity] < RANK[w] ? x.severity : w), 'ok'),
)
const verdict = computed(() => {
  switch (worst.value) {
    case 'critical': return 'Critical issues'
    case 'warn': return 'Needs attention'
    case 'info': return 'Healthy — minor notes'
    default: return 'All clear'
  }
})
const tally = computed(() =>
  (['critical', 'warn', 'info', 'ok'] as Severity[])
    .map((s) => ({ sev: s, glyph: GLYPH[s], n: counts.value[s] }))
    .filter((t) => t.n > 0),
)
// Checks whose detail is a metric (no item list) lead with the summary number.
const ITEMLESS = new Set(['cache-hit', 'wraparound'])
</script>

<template>
  <div>
    <p class="pg-loading" v-if="loading && !checks.length">Running checks…</p>

    <template v-else-if="checks.length">
      <!-- Overall verdict -->
      <div :class="['verdict', worst]">
        <div class="verdict-badge">{{ GLYPH[worst] }}</div>
        <div class="verdict-text">
          <div class="verdict-label">{{ verdict }}</div>
          <div class="verdict-sub">{{ checks.length }} checks run</div>
        </div>
        <div class="tally">
          <span v-for="t in tally" :key="t.sev" :class="['tally-pill', t.sev]">
            <span class="tally-glyph">{{ t.glyph }}</span>{{ t.n }}
          </span>
        </div>
      </div>

      <!-- Checks, worst-first -->
      <div class="checks-grid">
        <div
          v-for="(c, i) in sortedChecks"
          :key="c.id"
          :class="['check-card', c.severity]"
          :style="{ animationDelay: i * 40 + 'ms' }"
        >
          <div class="check-head">
            <span class="check-badge">{{ GLYPH[c.severity] }}</span>
            <span class="check-title">{{ c.title }}</span>
          </div>
          <div :class="['check-summary', { lead: ITEMLESS.has(c.id) }]">{{ c.summary }}</div>
          <div v-if="c.items.length" class="check-chips">
            <span v-for="(it, j) in c.items.slice(0, 8)" :key="j" class="check-chip">{{ it }}</span>
            <span v-if="c.items.length > 8" class="check-more">+{{ c.items.length - 8 }} more</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* Diagnostic readout — overall verdict banner + worst-first status cards. */
.verdict {
  display: flex;
  align-items: center;
  gap: var(--sp-4, 16px);
  padding: var(--sp-4, 16px) var(--sp-5, 20px);
  margin-bottom: var(--sp-5, 20px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md, 8px);
  background: var(--bg-surface);
}
.verdict.warn { background: color-mix(in srgb, var(--amber, #f59e0b) 6%, var(--bg-surface)); border-color: color-mix(in srgb, var(--amber, #f59e0b) 30%, var(--border-subtle)); }
.verdict.critical { background: color-mix(in srgb, var(--error, #ef4444) 7%, var(--bg-surface)); border-color: color-mix(in srgb, var(--error, #ef4444) 32%, var(--border-subtle)); }
.verdict-badge {
  width: 40px; height: 40px; flex-shrink: 0;
  display: grid; place-items: center;
  border-radius: 50%;
  font-size: 18px; font-weight: 700;
  color: var(--sev, var(--ok, #22c55e));
  background: color-mix(in srgb, var(--sev, #22c55e) 16%, transparent);
}
.verdict.ok { --sev: var(--ok, #22c55e); }
.verdict.info { --sev: #6b7280; }
.verdict.warn { --sev: var(--amber, #f59e0b); }
.verdict.critical { --sev: var(--error, #ef4444); }
.verdict-text { flex: 1; min-width: 0; }
.verdict-label { font-size: 17px; font-weight: 600; color: var(--text-primary); }
.verdict-sub { font-size: 12px; color: var(--text-tertiary); margin-top: 2px; }
.tally { display: flex; gap: 6px; }
.tally-pill {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; font-variant-numeric: tabular-nums;
  padding: 3px 9px; border-radius: 999px;
  background: var(--bg-hover); color: var(--text-secondary);
}
.tally-glyph { font-weight: 700; }
.tally-pill.ok .tally-glyph { color: var(--ok, #22c55e); }
.tally-pill.info .tally-glyph { color: #6b7280; }
.tally-pill.warn .tally-glyph { color: var(--amber, #f59e0b); }
.tally-pill.critical .tally-glyph { color: var(--error, #ef4444); }

.checks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: var(--sp-4, 16px); }
.check-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md, 8px);
  padding: var(--sp-4, 16px);
  position: relative; overflow: hidden;
  opacity: 0; animation: checkReveal 0.28s ease-out forwards;
}
/* accent rail */
.check-card::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--sev, var(--border-subtle)); }
.check-card.ok { --sev: var(--ok, #22c55e); }
.check-card.info { --sev: #6b7280; }
.check-card.warn { --sev: var(--amber, #f59e0b); }
.check-card.critical { --sev: var(--error, #ef4444); }
@keyframes checkReveal { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

.check-head { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
.check-badge {
  width: 22px; height: 22px; flex-shrink: 0;
  display: grid; place-items: center;
  border-radius: 6px;
  font-size: 12px; font-weight: 700;
  color: var(--sev);
  background: color-mix(in srgb, var(--sev) 15%, transparent);
}
.check-title { font-weight: 600; font-size: 14px; color: var(--text-primary); }
.check-summary { font-size: 13px; color: var(--text-secondary); line-height: 1.45; }
.check-summary.lead { font-size: 14px; color: var(--text-primary); }
.check-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
.check-chip {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px; color: var(--text-secondary);
  background: var(--bg-hover);
  padding: 2px 7px; border-radius: 4px;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.check-more { font-size: 11px; color: var(--text-tertiary); align-self: center; padding: 2px 2px; }
</style>
