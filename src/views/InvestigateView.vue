<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import InvestigationPanel from '../components/InvestigationPanel.vue'

const route = useRoute()
const eventId = ref((route.query.event as string) || '')
const question = ref((route.query.q as string) || '')
const additionalContext = ref((route.query.ctx as string) || '')
const started = ref(!!(eventId.value || question.value))
const inputQuestion = ref('')

function startInvestigation() {
  if (!inputQuestion.value.trim()) return
  question.value = inputQuestion.value.trim()
  started.value = true
}

function reset() {
  started.value = false
  question.value = ''
  eventId.value = ''
  additionalContext.value = ''
  inputQuestion.value = ''
}
</script>

<template>
  <div class="investigate-page" :class="{ 'investigate-page--direct': started && !inputQuestion }">
    <div v-if="!started" class="investigate-header">
      <h1>SRE Investigation</h1>
      <p class="investigate-subtitle">AI-powered anomaly investigation with real-time reasoning</p>
    </div>

    <div v-if="!started" class="investigate-form">
      <div class="form-group">
        <label>Ask a question about your system</label>
        <textarea
          v-model="inputQuestion"
          placeholder="e.g. Why is the checkout service seeing elevated error rates? What changed in the last hour?"
          rows="3"
          @keydown.meta.enter="startInvestigation"
          @keydown.ctrl.enter="startInvestigation"
        ></textarea>
      </div>
      <button class="btn btn-primary" @click="startInvestigation" :disabled="!inputQuestion.trim()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        Start Investigation
      </button>
    </div>

    <div v-else class="investigate-panel-wrap">
      <InvestigationPanel
        :event-id="eventId || undefined"
        :question="question || undefined"
        :additional-context="additionalContext || undefined"
        @close="reset"
      />
    </div>
  </div>
</template>

<style scoped>
.investigate-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 24px;
  min-height: 100vh;
}

.investigate-page--direct {
  max-width: 100%;
  padding: 0;
}

.investigate-header {
  margin-bottom: 24px;
}

.investigate-header h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 0 0 4px;
}

.investigate-subtitle {
  color: var(--text-secondary);
  font-size: 13px;
  margin: 0;
}

.investigate-form {
  max-width: 600px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--text-secondary);
}

.form-group textarea {
  width: 100%;
  padding: 10px 12px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
}

.form-group textarea:focus {
  outline: none;
  border-color: var(--amber);
}

.form-group textarea::placeholder {
  color: var(--text-muted);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--amber);
  color: var(--text-inverse);
  border: none;
  border-radius: var(--r-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--amber-hover);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.investigate-panel-wrap {
  height: calc(100vh - 140px);
}

.investigate-page--direct .investigate-panel-wrap {
  height: calc(100vh - 50px);
}
</style>
