<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../../../composables/useApi'
import PanelCard from '../../../components/PanelCard.vue'

const props = defineProps<{ server?: string; db?: string }>()
const api = useApi()
const route = useRoute()
const query = ref('')
const loading = ref(false)
const error = ref('')
const plan = ref<Record<string, unknown> | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer() { if (timer) clearTimeout(timer); timer = null }
async function poll(id: string) {
  try {
    const job = await api.getMySqlExplainJob(id)
    if (job.status === 'done') {
      plan.value = JSON.parse(job.plan_json) as Record<string, unknown>
      loading.value = false
      return
    }
    if (job.status === 'error') {
      error.value = job.error || 'MySQL could not build this plan.'
      loading.value = false
      return
    }
    timer = setTimeout(() => poll(id), 900)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not read the EXPLAIN result.'
    loading.value = false
  }
}

async function explain() {
  clearTimer()
  plan.value = null
  error.value = ''
  loading.value = true
  try {
    const { id } = await api.submitMySqlExplain(props.server || '', query.value, props.db || '')
    await poll(id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not submit this query.'
    loading.value = false
  }
}

onMounted(() => { if (typeof route.query.q === 'string') query.value = route.query.q })
onBeforeUnmount(clearTimer)
</script>

<template>
  <div class="mysql-explain">
    <header class="explain-head">
      <p>Plan inspection</p>
      <h2>Explain a read query</h2>
      <span>Rush asks the collector to run <code>EXPLAIN FORMAT=JSON</code>. The query itself is not executed.</span>
    </header>
    <PanelCard title="Query" description="Only one SELECT or WITH statement is accepted. EXPLAIN ANALYZE and locking reads are blocked." source-label="MySQL collector">
      <form class="query-form" @submit.prevent="explain">
        <label for="mysql-explain-query">SQL</label>
        <textarea id="mysql-explain-query" v-model="query" required spellcheck="false" placeholder="SELECT order_id, status FROM orders WHERE customer_id = ?"></textarea>
        <div class="form-foot">
          <span>{{ server || 'Choose an instance' }}<template v-if="db"> / {{ db }}</template></span>
          <button type="submit" :disabled="loading || !server || !query.trim()">{{ loading ? 'Building plan…' : 'Explain query' }}</button>
        </div>
      </form>
    </PanelCard>
    <PanelCard v-if="loading || error || plan" title="Optimizer plan" :loading="loading" :error="error || null" source-label="EXPLAIN FORMAT=JSON">
      <pre v-if="plan" class="plan-json">{{ JSON.stringify(plan, null, 2) }}</pre>
    </PanelCard>
  </div>
</template>

<style scoped>
.mysql-explain { display: grid; gap: 18px; max-width: 1080px; }
.explain-head { padding: 2px 2px 4px; }
.explain-head p { margin: 0 0 5px; color: var(--text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.explain-head h2 { margin: 0; font-size: clamp(22px, 3vw, 31px); letter-spacing: -.035em; }
.explain-head span { display: block; margin-top: 7px; color: var(--text-secondary); font-size: 13px; }
.query-form { display: grid; gap: 9px; }
.query-form label { color: var(--text-tertiary); font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .08em; }
textarea { box-sizing: border-box; width: 100%; min-height: 170px; resize: vertical; padding: 14px; border: 1px solid var(--border-subtle); background: var(--bg-primary); color: var(--text-primary); border-radius: var(--r-sm, 4px); font: 12px/1.6 var(--font-mono, monospace); }
textarea:focus { outline: 2px solid color-mix(in srgb, var(--blue, #3b82f6) 40%, transparent); border-color: var(--blue, #3b82f6); }
.form-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.form-foot span { color: var(--text-tertiary); font: 11px var(--font-mono, monospace); }
button { padding: 8px 13px; border: 0; background: var(--blue, #3b82f6); color: #f7f9fc; border-radius: var(--r-sm, 4px); font-size: 12px; font-weight: 650; cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
.plan-json { max-height: 620px; margin: 0; overflow: auto; white-space: pre-wrap; color: var(--text-secondary); font: 11px/1.65 var(--font-mono, monospace); }
@media (max-width: 620px) { .form-foot { align-items: stretch; flex-direction: column; } }
</style>
