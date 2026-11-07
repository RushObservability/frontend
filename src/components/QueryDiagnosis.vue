<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { apiRequest } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import type { DiagnosticRequest, QueryDiagnosis } from '../lib/queryDiagnostics'

const props = defineProps<{ request: DiagnosticRequest }>()
const { activeTenant } = useTenant()
const result = ref<QueryDiagnosis | null>(null)
const error = ref('')
const loading = ref(false)
let controller: AbortController | null = null

function reset() {
  controller?.abort()
  controller = null
  result.value = null
  error.value = ''
  loading.value = false
}
watch(() => JSON.stringify([activeTenant.value, props.request]), reset)
onBeforeUnmount(reset)

async function diagnose() {
  reset()
  if (props.request.filters.length > 8) {
    error.value = 'This check supports up to eight filters. Simplify the query and run it again.'
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const response = await apiRequest<QueryDiagnosis>('/explore/diagnose', {
      method: 'POST', body: JSON.stringify(props.request), signal: current.signal, invalidatesAnalytics: false,
    })
    if (controller === current && !current.signal.aborted) result.value = response
  } catch (cause) {
    if (controller === current && !current.signal.aborted) {
      error.value = 'The diagnostic check is unavailable. Try a shorter time range or retry.'
    }
  } finally {
    if (controller === current) loading.value = false
  }
}
</script>

<template>
  <div class="query-diagnosis" @click.stop>
    <button v-if="!result" type="button" class="diagnose-button" :disabled="loading" @click="diagnose">
      {{ loading ? 'Checking filters…' : 'Explain missing data' }}
    </button>
    <div v-if="result || error" class="diagnose-result" aria-live="polite">
      <p>{{ error || result?.message }}</p>
      <p v-if="result?.suggestions?.length">Similar services in this range: <code v-for="value in result.suggestions" :key="value">{{ value }}</code></p>
      <button v-if="result && !result.complete" type="button" class="diagnose-button" @click="diagnose">Retry check</button>
    </div>
  </div>
</template>

<style scoped>
.query-diagnosis { max-width: 620px; font-size: 12px; text-align: left; }
.diagnose-button { border: 1px solid var(--border-default); background: var(--bg-raised); color: var(--text-primary); padding: 6px 10px; border-radius: var(--r-sm); font: inherit; cursor: pointer; }
.diagnose-button:hover { border-color: var(--accent); }
.diagnose-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.diagnose-button:disabled { opacity: .6; cursor: progress; }
.diagnose-result { color: var(--text-secondary); line-height: 1.6; }
.diagnose-result p { margin: 8px 0; }
.diagnose-result code { display: inline-block; margin: 0 4px; color: var(--text-primary); overflow-wrap: anywhere; }
</style>
