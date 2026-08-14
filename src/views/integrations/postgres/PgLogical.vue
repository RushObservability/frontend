<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '../../../composables/useApi'
import type { PromVectorResponse } from '../../../types'
import DataTable, { type DataTableColumn } from '../../../components/DataTable.vue'

const props = defineProps<{ server?: string; host?: string; db?: string }>()
const api = useApi()
const loading = ref(false)
interface Subscription extends Record<string, unknown> { name: string; up: number; lastMessage: number; endAge: number; errors: number }
interface Publication extends Record<string, unknown> { name: string; tables: number }
const subscriptions = ref<Subscription[]>([])
const publications = ref<Publication[]>([])
const subscriptionColumns: DataTableColumn[] = [
  { key: 'name', label: 'Subscription', sortable: true },
  { key: 'up', label: 'Worker', sortable: true },
  { key: 'lastMessage', label: 'Last message', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'endAge', label: 'Latest end', align: 'right', sortable: true, cellClass: 'num' },
  { key: 'errors', label: 'Errors', align: 'right', sortable: true, cellClass: 'num' },
]
const publicationColumns: DataTableColumn[] = [
  { key: 'name', label: 'Publication', sortable: true },
  { key: 'tables', label: 'Tables', align: 'right', sortable: true, cellClass: 'num' },
]
function selector(): string {
  const p: string[] = []
  if (props.server) p.push('service_name="' + props.server + '"')
  if (props.host) p.push('host="' + props.host + '"')
  return p.length ? '{' + p.join(',') + '}' : ''
}
function n(value: string | undefined): number { return parseFloat(value || '0') || 0 }
function age(value: number): string {
  if (!isFinite(value)) return '—'
  if (value < 60) return Math.round(value) + 's'
  if (value < 3600) return Math.round(value / 60) + 'm'
  return (value / 3600).toFixed(1) + 'h'
}
async function vector(metric: string): Promise<PromVectorResponse['result']> {
  try { return (await api.promQuery(metric + selector())).result } catch { return [] }
}
async function load() {
  loading.value = true
  const [up, lastMessage, endAge, errors] = await Promise.all([
    vector('postgresql_logical_subscription_up'),
    vector('postgresql_logical_subscription_last_message_age'),
    vector('postgresql_logical_subscription_latest_end_age'),
    vector('postgresql_logical_subscription_errors'),
  ])
  const map = new Map<string, Subscription>()
  const ensure = (name: string) => {
    const item = map.get(name) || { name: name || 'unnamed', up: 0, lastMessage: NaN, endAge: NaN, errors: 0 }
    map.set(name, item); return item
  }
  for (const item of up) ensure(item.metric.subscription || '').up = n(item.value?.[1])
  for (const item of lastMessage) ensure(item.metric.subscription || '').lastMessage = n(item.value?.[1])
  for (const item of endAge) ensure(item.metric.subscription || '').endAge = n(item.value?.[1])
  for (const item of errors) ensure(item.metric.subscription || '').errors += n(item.value?.[1])
  subscriptions.value = Array.from(map.values()).sort((a, b) => b.errors - a.errors || b.endAge - a.endAge)
  try {
    const filters = [] as Array<{ field: string; op: '='; value: string }>
    if (props.server) filters.push({ field: 'service_name', op: '=', value: props.server })
    if (props.host) filters.push({ field: 'log.host', op: '=', value: props.host })
    const logs = await api.queryLogs({
      time_range: { from: new Date(Date.now() - 24 * 3600_000).toISOString(), to: new Date().toISOString() },
      filters: [...filters, { field: 'log.event', op: '=', value: 'postgresql.publication' }],
      limit: 500,
    })
    publications.value = (logs.rows as Array<{ LogAttributes: Record<string, string> }>).map((item) => ({
      name: item.LogAttributes.publication || 'unnamed',
      tables: n(item.LogAttributes.tables),
    }))
  } catch { publications.value = [] }
  loading.value = false
}
function subscriptionRow(row: Record<string, unknown>): Subscription { return row as Subscription }
function publicationRow(row: Record<string, unknown>): Publication { return row as Publication }
onMounted(load)
watch(() => [props.server, props.host, props.db], load)
</script>

<template>
  <div class="pg-logical">
    <section class="logical-head"><div><div class="eyebrow">Cross-cluster data flow</div><h2>Logical replication</h2><p>Monitor subscription workers, apply freshness, replication errors, and publication coverage.</p></div><div class="logical-note">Empty means this instance may be a publisher or use physical replication.</div></section>
    <section class="logical-section"><div class="section-head"><div><h3>Subscriptions</h3><p>Latest observations from pg_stat_subscription and pg_stat_subscription_stats.</p></div></div><p v-if="loading && !subscriptions.length" class="pg-empty">Loading subscriptions…</p><p v-else-if="!subscriptions.length" class="pg-empty">No logical subscriptions are reporting.</p><DataTable v-else :columns="subscriptionColumns" :rows="subscriptions" row-key="name"><template #cell-name="{ row }"><strong>{{ subscriptionRow(row).name }}</strong></template><template #cell-up="{ row }"><span :class="subscriptionRow(row).up ? 'ok' : 'bad'">{{ subscriptionRow(row).up ? 'running' : 'stopped' }}</span></template><template #cell-lastMessage="{ row }">{{ age(subscriptionRow(row).lastMessage) }}</template><template #cell-endAge="{ row }">{{ age(subscriptionRow(row).endAge) }}</template><template #cell-errors="{ row }">{{ Math.round(subscriptionRow(row).errors) }}</template></DataTable></section>
    <section class="logical-section"><div class="section-head"><div><h3>Publications</h3><p>Published table counts are collected as metadata only.</p></div></div><p v-if="!publications.length" class="pg-empty">No publication snapshot is available.</p><DataTable v-else :columns="publicationColumns" :rows="publications" row-key="name"><template #cell-name="{ row }"><strong>{{ publicationRow(row).name }}</strong></template><template #cell-tables="{ row }">{{ Math.round(publicationRow(row).tables) }}</template></DataTable></section>
  </div>
</template>

<style scoped>
.pg-logical { display: grid; gap: 22px; }
.logical-head { display: flex; justify-content: space-between; gap: 24px; padding: 22px 24px; border: 1px solid var(--border-subtle); background: var(--bg-surface); border-radius: var(--r-md, 8px); }
.eyebrow { color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 5px 0; font-size: 24px; letter-spacing: -.025em; }
.logical-head p, .section-head p { margin: 0; color: var(--text-tertiary); font-size: 12px; line-height: 1.5; }
.logical-note { max-width: 300px; color: var(--text-secondary); font-size: 12px; line-height: 1.5; }
.section-head { margin-bottom: 10px; }
h3 { margin: 0 0 3px; font-size: 15px; }
.num { font-family: var(--font-mono, monospace); font-size: 11px; }
.ok { color: var(--ok, #22c55e); font-size: 12px; }
.bad { color: var(--error, #ef4444); font-size: 12px; }
@media (max-width: 760px) { .logical-head { display: block; } .logical-note { margin-top: 16px; max-width: none; } }
</style>
