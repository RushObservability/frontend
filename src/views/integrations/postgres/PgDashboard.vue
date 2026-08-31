<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../../../composables/useApi'
import type { Dashboard } from '../../../types'

const api = useApi()
const router = useRouter()
const existing = ref<Dashboard | null>(null)
const loading = ref(true)
const creating = ref(false)
const error = ref('')

const TEMPLATE_ID = 'tpl-postgresql-overview'
const DASH_NAME = 'PostgreSQL'

async function load() {
  loading.value = true
  try {
    const res = await api.listDashboards()
    existing.value = res.dashboards.find((d) => d.name === DASH_NAME) ?? null
  } catch { /* ignore */ } finally {
    loading.value = false
  }
}

async function create() {
  creating.value = true
  error.value = ''
  try {
    const dash = await api.createFromTemplate(TEMPLATE_ID, DASH_NAME)
    router.push(`/dashboards/${dash.id}`)
  } catch (e: any) {
    error.value = e?.message || 'Failed to create dashboard'
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="pg-setup">
    <p v-if="loading" class="pg-loading">Loading…</p>
    <template v-else-if="existing">
      <p>An editable <strong>PostgreSQL</strong> dashboard is provisioned.</p>
      <button class="btn btn-primary" @click="router.push(`/dashboards/${existing.id}`)">Open dashboard →</button>
    </template>
    <template v-else>
      <p>
        Provision an editable <strong>PostgreSQL</strong> dashboard from the built-in template —
        metric panels (<code>postgresql_*</code>) plus a top-queries panel. You can edit it like any
        other dashboard afterward.
      </p>
      <button class="btn btn-primary" :disabled="creating" @click="create">
        {{ creating ? 'Creating…' : 'Create PostgreSQL dashboard' }}
      </button>
      <p v-if="error" class="save-error" style="margin-top:8px">{{ error }}</p>
    </template>
  </div>
</template>
