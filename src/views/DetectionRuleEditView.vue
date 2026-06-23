<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { DetectionRule } from '../types'

const props = defineProps<{
  id?: string
}>()

const api = useApi()
const router = useRouter()

const loading = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const testing = ref(false)
const testResults = ref<any[] | null>(null)
const testError = ref<string | null>(null)

const isEdit = computed(() => !!props.id)

// Form fields
const name = ref('')
const description = ref('')
const querySql = ref('')
const severity = ref('medium')
const intervalSecs = ref(300)
const windowSecs = ref(300)
const threshold = ref(1)
const enabled = ref(true)

const severityOptions = ['critical', 'high', 'medium', 'low', 'info']
const intervalOptions = [
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
]
const windowOptions = [
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
  { label: '6h', value: 21600 },
  { label: '24h', value: 86400 },
]

onMounted(async () => {
  if (props.id) {
    loading.value = true
    try {
      const rule: DetectionRule = await api.getDetectionRule(props.id)
      name.value = rule.name
      description.value = rule.description
      querySql.value = rule.query_sql
      severity.value = rule.severity
      intervalSecs.value = rule.interval_secs
      windowSecs.value = rule.window_secs
      threshold.value = rule.threshold
      enabled.value = rule.enabled
    } catch { /* error in api.error */ }
    finally { loading.value = false }
  }
})

async function handleSave() {
  saveError.value = null
  saving.value = true
  const data = {
    name: name.value,
    description: description.value,
    query_sql: querySql.value,
    severity: severity.value,
    interval_secs: intervalSecs.value,
    window_secs: windowSecs.value,
    threshold: threshold.value,
    enabled: enabled.value,
  }
  try {
    if (props.id) {
      await api.updateDetectionRule(props.id, data)
    } else {
      await api.createDetectionRule(data)
    }
    router.push('/detection')
  } catch (e: any) {
    saveError.value = e.message || 'Failed to save rule'
  } finally {
    saving.value = false
  }
}

async function handleTest() {
  if (!props.id) return
  testing.value = true
  testError.value = null
  testResults.value = null
  try {
    const res = await api.testDetectionRule(props.id)
    testResults.value = res.rows
  } catch (e: any) {
    testError.value = e.message || 'Test failed'
  } finally {
    testing.value = false
  }
}

function handleCancel() {
  router.push('/detection')
}
</script>

<template>
  <div class="detection-edit-page">
    <div class="page-header">
      <div class="page-header-left">
        <router-link to="/detection" class="back-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </router-link>
        <div class="page-header-text">
          <h1 class="page-title">{{ isEdit ? 'Edit Detection Rule' : 'New Detection Rule' }}</h1>
          <p class="page-subtitle">{{ isEdit ? 'Modify the detection rule configuration' : 'Define a SQL-based SIEM detection rule' }}</p>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-panel card">
      <span class="spinner"></span>
      <span>Loading...</span>
    </div>

    <div v-if="saveError" class="save-error fade-in">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      {{ saveError }}
    </div>

    <div v-if="!loading" class="form-card card">
      <!-- Name -->
      <div class="form-group">
        <label class="form-label">Name</label>
        <input v-model="name" class="form-input" type="text" placeholder="e.g. Failed Login Spike" />
      </div>

      <!-- Description -->
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea v-model="description" class="form-input form-textarea" rows="2" placeholder="What does this rule detect?"></textarea>
      </div>

      <!-- SQL Query -->
      <div class="form-group">
        <label class="form-label">SQL Query</label>
        <textarea
          v-model="querySql"
          class="form-input sql-editor"
          rows="8"
          placeholder="SELECT count(*) as cnt FROM logs WHERE severity = 'error' AND timestamp BETWEEN @window_start AND @window_end"
          spellcheck="false"
        ></textarea>
        <div class="form-hint">
          Use <code>@window_start</code> and <code>@window_end</code> as time placeholders. The engine auto-injects <code>AND tenant_id = '...'</code>.
        </div>
      </div>

      <!-- Row of selectors -->
      <div class="form-row">
        <!-- Severity -->
        <div class="form-group form-group-sm">
          <label class="form-label">Severity</label>
          <select v-model="severity" class="form-input form-select">
            <option v-for="s in severityOptions" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <!-- Interval -->
        <div class="form-group form-group-sm">
          <label class="form-label">Interval</label>
          <select v-model.number="intervalSecs" class="form-input form-select">
            <option v-for="opt in intervalOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <!-- Window -->
        <div class="form-group form-group-sm">
          <label class="form-label">Window</label>
          <select v-model.number="windowSecs" class="form-input form-select">
            <option v-for="opt in windowOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>

        <!-- Threshold -->
        <div class="form-group form-group-sm">
          <label class="form-label">Threshold</label>
          <input v-model.number="threshold" class="form-input" type="number" min="1" />
        </div>
      </div>

      <!-- Enabled toggle -->
      <div class="form-group form-group-inline">
        <label class="form-label">Enabled</label>
        <label class="toggle-wrap">
          <input type="checkbox" v-model="enabled" />
          <span class="toggle-slider"></span>
        </label>
      </div>

      <!-- Test Button (edit mode only) -->
      <div v-if="isEdit" class="form-group">
        <button class="btn-test" :disabled="testing" @click="handleTest">
          <span v-if="testing" class="spinner-sm"></span>
          <span v-else>&#9654;</span>
          Test Rule
        </button>
      </div>

      <!-- Test Results -->
      <div v-if="testResults !== null || testError" class="test-panel fade-in">
        <div class="test-panel-header">
          <span class="test-panel-title mono">Test Results</span>
          <span v-if="testResults" class="test-panel-count">{{ testResults.length }} rows</span>
        </div>
        <div v-if="testError" class="test-error">{{ testError }}</div>
        <div v-else-if="testResults && testResults.length === 0" class="test-empty text-muted">
          No matches found
        </div>
        <pre v-else-if="testResults" class="test-output mono">{{ JSON.stringify(testResults, null, 2) }}</pre>
      </div>

      <!-- Actions -->
      <div class="form-actions">
        <button class="btn-save" :disabled="saving || !name || !querySql" @click="handleSave">
          {{ saving ? 'Saving...' : (isEdit ? 'Update Rule' : 'Create Rule') }}
        </button>
        <button class="btn-cancel" @click="handleCancel">Cancel</button>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/DetectionRuleEditView.css"></style>
