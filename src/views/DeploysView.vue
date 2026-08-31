<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import type { DeployMarker } from '../types'

const api = useApi()
const route = useRoute()
const { canWrite } = useAuth()

const deploys = ref<DeployMarker[]>([])
const showForm = ref(false)
// Preselect the service filter when arriving from a service page (?service=).
const filterService = ref((route.query.service as string) || '')

// Form fields
const serviceName = ref('')
const version = ref('')
const commitSha = ref('')
const description = ref('')
const environment = ref('production')
const deployedBy = ref('')

const filteredDeploys = computed(() => {
  if (!filterService.value) return deploys.value
  return deploys.value.filter(d => d.service_name === filterService.value)
})

const knownServices = computed(() => {
  const set = new Set(deploys.value.map(d => d.service_name))
  return Array.from(set).sort()
})

onMounted(async () => {
  await loadDeploys()
})

async function loadDeploys() {
  try {
    const res = await api.listDeploys()
    deploys.value = res.deploys
  } catch { /* error in api.error */ }
}

async function recordDeploy() {
  if (!serviceName.value.trim() || !version.value.trim()) return
  try {
    await api.createDeploy({
      service_name: serviceName.value.trim(),
      version: version.value.trim(),
      commit_sha: commitSha.value.trim(),
      description: description.value.trim(),
      environment: environment.value.trim(),
      deployed_by: deployedBy.value.trim(),
    })
    showForm.value = false
    resetForm()
    await loadDeploys()
  } catch { /* error in api.error */ }
}

function resetForm() {
  serviceName.value = ''
  version.value = ''
  commitSha.value = ''
  description.value = ''
  environment.value = 'production'
  deployedBy.value = ''
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    })
  } catch { return ts }
}
</script>

<template>
  <div class="deploys-page">
    <div class="section-header">
      <h2 class="section-title">Deploys</h2>
      <div class="header-actions">
        <select v-if="knownServices.length" v-model="filterService" class="filter-select mono">
          <option value="">All services</option>
          <option v-for="svc in knownServices" :key="svc" :value="svc">{{ svc }}</option>
        </select>
        <button v-if="canWrite" class="btn-create" @click="showForm = !showForm">
          {{ showForm ? 'Cancel' : '+ Record Deploy' }}
        </button>
      </div>
    </div>

    <div v-if="showForm" class="deploy-form card fade-in">
      <div class="form-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Service Name *</label>
            <input v-model="serviceName" class="form-input mono" placeholder="api-gateway" />
          </div>
          <div class="form-group">
            <label class="form-label">Version *</label>
            <input v-model="version" class="form-input mono" placeholder="v1.2.3" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Commit SHA</label>
            <input v-model="commitSha" class="form-input mono" placeholder="abc1234" />
          </div>
          <div class="form-group">
            <label class="form-label">Environment</label>
            <select v-model="environment" class="form-input mono">
              <option value="production">production</option>
              <option value="staging">staging</option>
              <option value="development">development</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Deployed By</label>
            <input v-model="deployedBy" class="form-input" placeholder="Jane Doe" />
          </div>
          <div class="form-group">
            <label class="form-label">Description</label>
            <input v-model="description" class="form-input" placeholder="Fixed checkout bug" />
          </div>
        </div>
        <div class="form-actions">
          <button class="btn btn-secondary" @click="showForm = false; resetForm()">Cancel</button>
          <button class="btn btn-primary" @click="recordDeploy">Record Deploy</button>
        </div>
      </div>
    </div>

    <div v-if="api.error.value" class="empty-state card">
      <div class="empty-state-icon" style="color: var(--error)">!</div>
      <div>{{ api.error.value }}</div>
    </div>

    <div v-else-if="filteredDeploys.length === 0 && !showForm" class="empty-state card">
      <div class="empty-state-icon">&#9654;</div>
      <div>No deploys recorded</div>
      <div class="text-secondary" style="font-size: 11px">Record one to see it on timeseries widgets</div>
    </div>

    <div v-for="deploy in filteredDeploys" :key="deploy.id" class="deploy-card card fade-in">
      <div class="deploy-row">
        <div class="deploy-icon">&#9654;</div>
        <div class="deploy-info">
          <div class="deploy-title">
            <span class="deploy-service mono">{{ deploy.service_name }}</span>
            <span class="deploy-version mono text-secondary">{{ deploy.version }}</span>
          </div>
          <div class="deploy-meta text-secondary">
            <span v-if="deploy.description">{{ deploy.description }}</span>
            <span v-if="deploy.description && deploy.deployed_by"> &middot; </span>
            <span v-if="deploy.deployed_by">by {{ deploy.deployed_by }}</span>
          </div>
        </div>
        <div class="deploy-env">
          <span class="env-tag mono" :class="'env-' + deploy.environment">{{ deploy.environment }}</span>
        </div>
        <div v-if="deploy.commit_sha" class="deploy-commit mono text-muted" :title="deploy.commit_sha">
          {{ deploy.commit_sha.substring(0, 7) }}
        </div>
        <div class="deploy-time mono text-muted">{{ formatDate(deploy.deployed_at) }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/DeploysView.css"></style>
