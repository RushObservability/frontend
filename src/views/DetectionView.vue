<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useFeatures } from '../composables/useFeatures'
import { useAuth } from '../composables/useAuth'
import type { DetectionRule, DetectionEvent } from '../types'

const api = useApi()
const { features } = useFeatures()
const router = useRouter()
const { canWrite } = useAuth()

const rules = ref<DetectionRule[]>([])
const events = ref<DetectionEvent[]>([])
const rulesLoading = ref(false)
const eventsLoading = ref(false)
const testResults = ref<Record<string, any[]>>({})
const testingRule = ref<string | null>(null)
const expandedTest = ref<string | null>(null)
const deleteConfirm = ref<string | null>(null)
const togglingRule = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([loadRules(), loadEvents()])
})

async function loadRules() {
  rulesLoading.value = true
  try {
    const res = await api.listDetectionRules()
    rules.value = res.rules
  } catch { /* error in api.error */ }
  finally { rulesLoading.value = false }
}

async function loadEvents() {
  eventsLoading.value = true
  try {
    const res = await api.listDetectionEvents()
    events.value = res.events
  } catch { /* error in api.error */ }
  finally { eventsLoading.value = false }
}

async function handleTest(rule: DetectionRule) {
  if (testingRule.value === rule.id) return
  testingRule.value = rule.id
  expandedTest.value = rule.id
  try {
    const res = await api.testDetectionRule(rule.id)
    testResults.value[rule.id] = res.rows
  } catch (e: any) {
    testResults.value[rule.id] = [{ error: e.message || 'Test failed' }]
  } finally {
    testingRule.value = null
  }
}

function toggleTestPanel(id: string) {
  expandedTest.value = expandedTest.value === id ? null : id
}

async function handleDelete(id: string) {
  try {
    await api.deleteDetectionRule(id)
    rules.value = rules.value.filter(r => r.id !== id)
    deleteConfirm.value = null
  } catch { /* error in api.error */ }
}

async function handleToggle(rule: DetectionRule) {
  togglingRule.value = rule.id
  try {
    await api.updateDetectionRule(rule.id, { enabled: !rule.enabled })
    rule.enabled = !rule.enabled
  } catch { /* error in api.error */ }
  finally { togglingRule.value = null }
}

function investigateDetection(rule: DetectionRule) {
  const ctx = `Detection rule "${rule.name}" (${rule.severity}) fired. Description: ${rule.description || 'none'}. Query: ${rule.query_sql}`
  router.push({
    path: '/investigate',
    query: { q: `Investigate detection rule: ${rule.name}`, ctx },
  })
}

function formatInterval(secs: number): string {
  if (secs >= 3600) return `${secs / 3600}h`
  if (secs >= 60) return `${secs / 60}m`
  return `${secs}s`
}

function formatDate(ts: string | null): string {
  if (!ts) return '-'
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}

function severityClass(severity: string): string {
  return `sev-${severity}`
}

function lastTriggered(ruleId: string): string {
  const ruleEvents = events.value.filter(e => e.rule_id === ruleId)
  if (ruleEvents.length === 0) return '-'
  const latest = ruleEvents.reduce((a, b) => new Date(a.created_at) > new Date(b.created_at) ? a : b)
  return formatDate(latest.created_at)
}

function ruleName(ruleId: string): string {
  const rule = rules.value.find(r => r.id === ruleId)
  return rule?.name || ruleId.slice(0, 8)
}

function samplePreview(data: any[]): string {
  if (!data || data.length === 0) return '-'
  const first = data[0]
  if (typeof first === 'string') return first.slice(0, 80)
  return JSON.stringify(first).slice(0, 80)
}
</script>

<template>
  <div class="detection-page">
    <!-- Detection Rules Section -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">
          <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          Detection Rules
        </h2>
        <router-link v-if="canWrite" to="/detection/new" class="btn-create">+ Create Rule</router-link>
      </div>

      <div v-if="rulesLoading" class="empty-state card">
        <div class="text-muted">Loading rules...</div>
      </div>

      <div v-else-if="rules.length === 0" class="empty-state card">
        <div class="empty-state-icon">&#9733;</div>
        <div>No detection rules</div>
        <div class="text-secondary" style="font-size: 11px">Create a SIEM detection rule to start monitoring</div>
      </div>

      <div v-for="rule in rules" :key="rule.id" class="rule-card card fade-in">
        <div class="rule-row">
          <div class="rule-info">
            <div class="rule-name">{{ rule.name }}</div>
            <div class="rule-desc text-secondary">{{ rule.description || 'No description' }}</div>
          </div>
          <span class="sev-badge" :class="severityClass(rule.severity)">{{ rule.severity }}</span>
          <span class="rule-interval mono text-muted">every {{ formatInterval(rule.interval_secs) }}</span>
          <span class="rule-window mono text-muted">{{ formatInterval(rule.window_secs) }} window</span>
          <span class="rule-triggered mono text-muted">{{ lastTriggered(rule.id) }}</span>
          <label class="toggle-wrap" @click.stop>
            <input
              type="checkbox"
              :checked="rule.enabled"
              :disabled="togglingRule === rule.id"
              @change="handleToggle(rule)"
            />
            <span class="toggle-slider"></span>
          </label>
          <div class="rule-actions">
            <button v-if="features.sre_agent" class="btn-investigate btn-investigate-sm" @click.stop="investigateDetection(rule)">Investigate</button>
            <router-link v-if="canWrite" :to="'/detection/' + rule.id + '/edit'" class="action-btn" title="Edit" @click.stop>&#9998;</router-link>
            <button class="action-btn" title="Test" @click.stop="handleTest(rule)">
              <span v-if="testingRule === rule.id" class="spinner-sm"></span>
              <span v-else>&#9654;</span>
            </button>
            <template v-if="canWrite">
              <button
                v-if="deleteConfirm !== rule.id"
                class="action-btn action-btn-danger"
                title="Delete"
                @click.stop="deleteConfirm = rule.id"
              >&times;</button>
              <span v-else class="delete-confirm" @click.stop>
                <button class="confirm-yes" @click="handleDelete(rule.id)">Delete</button>
                <button class="confirm-no" @click="deleteConfirm = null">Cancel</button>
              </span>
            </template>
          </div>
        </div>

        <!-- Test results panel -->
        <div v-if="expandedTest === rule.id && testResults[rule.id]" class="test-panel fade-in">
          <div class="test-panel-header">
            <span class="test-panel-title mono">Test Results</span>
            <span class="test-panel-count">{{ testResults[rule.id]!.length }} rows</span>
            <button class="action-btn" @click="toggleTestPanel(rule.id)">&times;</button>
          </div>
          <div v-if="testResults[rule.id]!.length === 0" class="test-empty text-muted">
            No matches found
          </div>
          <pre v-else class="test-output mono">{{ JSON.stringify(testResults[rule.id], null, 2) }}</pre>
        </div>
      </div>
    </div>

    <!-- Detection Events Section -->
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">
          <svg class="section-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Recent Detections
          <span v-if="events.length > 0" class="count-badge">{{ events.length }}</span>
        </h2>
      </div>

      <div v-if="eventsLoading" class="empty-state card">
        <div class="text-muted">Loading events...</div>
      </div>

      <div v-else-if="events.length === 0" class="empty-state card">
        <div class="empty-state-icon">&#10003;</div>
        <div>No detection events</div>
        <div class="text-secondary" style="font-size: 11px">Events will appear here when rules trigger</div>
      </div>

      <div v-else class="events-table card">
        <div v-for="ev in events" :key="ev.id" class="event-row">
          <span class="event-time mono text-muted">{{ formatDate(ev.created_at) }}</span>
          <router-link
            :to="'/detection/' + ev.rule_id + '/edit'"
            class="event-rule mono"
          >{{ ruleName(ev.rule_id) }}</router-link>
          <span class="sev-badge" :class="severityClass(ev.severity)">{{ ev.severity }}</span>
          <span class="event-matches mono">{{ ev.match_count }} matches</span>
          <span class="event-sample text-secondary mono">{{ samplePreview(ev.sample_data) }}</span>
        </div>
      </div>
    </div>

    <!-- Delete confirmation overlay -->
  </div>
</template>

<style scoped src="../styles/views/DetectionView.css"></style>
