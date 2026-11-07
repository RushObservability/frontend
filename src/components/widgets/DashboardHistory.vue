<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useApi } from '../../composables/useApi'
import { parseUtcTimestamp } from '../../lib/utcTimestamp'
import { restorePreview, versionReasonLabel } from '../../lib/dashboardHistory'
import type { DashboardVersion, DashboardVersionSummary, DashboardWithWidgets } from '../../types'

const props = defineProps<{ dashboard: DashboardWithWidgets; canRestore: boolean }>()
const emit = defineEmits<{ restored: [dashboard: DashboardWithWidgets]; close: [] }>()

const api = useApi()
const versions = ref<DashboardVersionSummary[]>([])
const loading = ref(true)
const selected = ref<DashboardVersion | null>(null)
const loadingVersion = ref(false)
const restoring = ref(false)

const preview = computed(() => selected.value && restorePreview(selected.value, props.dashboard))
const nothingToRestore = computed(() => !!preview.value && !preview.value.renamedTo
  && !preview.value.returning.length && !preview.value.removing.length && !preview.value.changing.length)

function when(createdAt: string): string {
  const ms = parseUtcTimestamp(createdAt)
  return Number.isNaN(ms) ? createdAt : new Date(ms).toLocaleString()
}

onMounted(async () => {
  try {
    versions.value = (await api.listDashboardVersions(props.dashboard.id)).versions
  } catch { /* error in api.error */ } finally {
    loading.value = false
  }
})

async function select(v: DashboardVersionSummary) {
  if (loadingVersion.value) return
  loadingVersion.value = true
  try {
    selected.value = await api.getDashboardVersion(props.dashboard.id, v.id)
  } catch { /* error in api.error */ } finally {
    loadingVersion.value = false
  }
}

async function restore() {
  if (!selected.value || restoring.value) return
  restoring.value = true
  try {
    emit('restored', await api.restoreDashboardVersion(props.dashboard.id, selected.value.id))
  } catch { /* error in api.error */ } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div class="dh-backdrop" @click.self="emit('close')">
    <div class="dh-modal card" role="dialog" aria-modal="true" aria-labelledby="dh-title">
      <div class="dh-header">
        <div id="dh-title" class="dh-title">Version history</div>
        <button class="dh-close" aria-label="Close version history" @click="emit('close')">&times;</button>
      </div>

      <div v-if="api.error.value" class="dh-error" role="alert">{{ api.error.value }}</div>

      <div class="dh-body">
        <ol class="dh-list" aria-label="Saved versions, newest first">
          <li v-if="loading" class="dh-empty text-muted">Loading versions…</li>
          <li v-else-if="!versions.length" class="dh-empty text-muted">
            No versions yet. A version is saved after every edit from now on.
          </li>
          <li v-for="(v, i) in versions" :key="v.id">
            <button
              class="dh-version"
              :class="{ active: selected?.id === v.id }"
              :aria-pressed="selected?.id === v.id"
              @click="select(v)"
            >
              <span class="dh-version-reason">{{ versionReasonLabel(v.reason) }}</span>
              <span class="dh-version-meta mono">
                {{ when(v.created_at) }}<template v-if="v.created_by_name"> · {{ v.created_by_name }}</template>
              </span>
              <span v-if="i === 0" class="dh-current">Current</span>
            </button>
          </li>
        </ol>

        <section class="dh-detail" aria-live="polite">
          <p v-if="!selected" class="dh-empty text-muted">Select a version to see what restoring it would change.</p>
          <template v-else-if="preview">
            <div class="dh-detail-title">{{ selected.snapshot.dashboard.name }}</div>
            <div class="dh-detail-meta mono">
              {{ selected.snapshot.widgets.length }} panels · saved {{ when(selected.created_at) }}
            </div>
            <p v-if="nothingToRestore" class="dh-empty text-muted">This version matches the dashboard as it is now.</p>
            <ul v-else class="dh-changes">
              <li v-if="preview.renamedTo">Renames the dashboard to <strong>{{ preview.renamedTo }}</strong></li>
              <li v-for="t in preview.returning" :key="`r-${t}`" class="dh-change-add">Brings back <strong>{{ t }}</strong></li>
              <li v-for="t in preview.removing" :key="`x-${t}`" class="dh-change-remove">Removes <strong>{{ t }}</strong></li>
              <li v-for="t in preview.changing" :key="`c-${t}`">Reverts changes to <strong>{{ t }}</strong></li>
            </ul>
            <p class="dh-hint text-muted">
              The current dashboard stays in this list, so a restore can be undone. Visibility is not changed.
            </p>
          </template>
        </section>
      </div>

      <div class="dh-footer">
        <button class="btn btn-secondary" @click="emit('close')">Close</button>
        <button
          v-if="canRestore"
          class="btn btn-primary"
          :disabled="!selected || nothingToRestore || restoring || loadingVersion"
          @click="restore"
        >
          {{ restoring ? 'Restoring…' : 'Restore this version' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped src="../../styles/widgets/DashboardHistory.css"></style>
