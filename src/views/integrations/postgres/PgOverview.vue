<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)

interface Stat { label: string; value: string; sub?: string }
const stats = ref<Stat[]>([])

function labels(extra: Record<string, string> = {}): string {
  const parts: string[] = []
  if (props.server) parts.push(`service_name="${props.server}"`)
  if (props.host) parts.push(`host="${props.host}"`)
  if (props.db) parts.push(`db="${props.db}"`)
  for (const [k, v] of Object.entries(extra)) parts.push(`${k}="${v}"`)
  return parts.length ? `{${parts.join(',')}}` : ''
}

function sumVec(r: PromVectorResponse): number {
  return r.result.reduce((a, s) => a + (parseFloat(s.value?.[1] ?? '0') || 0), 0)
}

async function q(promql: string): Promise<number> {
  try { return sumVec(await api.promQuery(promql)) } catch { return NaN }
}

function fmtBytes(n: number): string {
  if (!isFinite(n)) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let i = 0; let v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
const fmtNum = (n: number) => (isFinite(n) ? Math.round(n).toLocaleString() : '—')
const fmtRate = (n: number) => (isFinite(n) ? n.toFixed(1) : '—')

async function load() {
  loading.value = true
  const L = labels()
  const [backends, dbSize, active, idle, idleTx, hit, read, commits, rollbacks, deadlocks, repl] =
    await Promise.all([
      q(`sum(postgresql_backends${L})`),
      q(`sum(postgresql_db_size${L})`),
      q(`sum(postgresql_connection_count${labels({ state: 'active' })})`),
      q(`sum(postgresql_connection_count${labels({ state: 'idle' })})`),
      q(`sum(postgresql_connection_count${labels({ state: 'idle in transaction' })})`),
      q(`sum(postgresql_blocks_read${labels({ source: 'hit' })})`),
      q(`sum(postgresql_blocks_read${labels({ source: 'read' })})`),
      q(`sum(rate(postgresql_commits${L}[5m]))`),
      q(`sum(rate(postgresql_rollbacks${L}[5m]))`),
      q(`sum(postgresql_deadlocks${L})`),
      q(`max(postgresql_replication_data_delay${L})`),
    ])

  const cacheHit = hit + read > 0 ? (hit / (hit + read)) * 100 : NaN
  stats.value = [
    { label: 'Connections', value: fmtNum(backends), sub: `${fmtNum(active)} active · ${fmtNum(idle)} idle · ${fmtNum(idleTx)} idle-in-txn` },
    { label: 'Database size', value: fmtBytes(dbSize) },
    { label: 'Cache hit ratio', value: isFinite(cacheHit) ? `${cacheHit.toFixed(1)}%` : '—' },
    { label: 'Commits / s', value: fmtRate(commits), sub: `${fmtRate(rollbacks)} rollbacks/s` },
    { label: 'Deadlocks', value: fmtNum(deadlocks), sub: 'cumulative' },
    { label: 'Replication delay', value: isFinite(repl) && repl > 0 ? fmtBytes(repl) : '—' },
  ]
  loading.value = false
}

onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div>
    <div v-if="loading && !stats.length" class="pg-loading">Loading…</div>
    <div class="pg-stat-grid">
      <div v-for="s in stats" :key="s.label" class="pg-stat">
        <div class="label">{{ s.label }}</div>
        <div class="value">{{ s.value }}</div>
        <div v-if="s.sub" class="sub">{{ s.sub }}</div>
      </div>
    </div>
  </div>
</template>
