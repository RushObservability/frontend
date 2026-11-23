<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import DataTable from '../components/DataTable.vue'
import EmptyState from '../components/EmptyState.vue'
import RumAppLayout from '../components/RumAppLayout.vue'
import { useApi } from '../composables/useApi'
import { useTenant } from '../composables/useTenant'
import type { RumCohort, RumCohortReport } from '../types'

const props = defineProps<{ appName: string }>()
const route = useRoute()
const router = useRouter()
const api = useApi()
const { activeTenant } = useTenant()

const followUpWeeks = [1, 2, 3, 4, 5]
const heatStops = [5, 12, 20, 28, 36, 44]
const dayMs = 86_400_000
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
const numberFormat = new Intl.NumberFormat()
const percentFormat = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

const firstAction = computed(() => typeof route.query.firstAction === 'string' ? route.query.firstAction : '')
const report = ref<RumCohortReport>()
const loading = ref(true)
const error = ref(false)
const retry = ref(0)
const selected = ref<{ weekStart: string; week: number }>()

const actionOptions = computed(() => {
  const actions = report.value?.first_actions ?? []
  return firstAction.value && !actions.includes(firstAction.value) ? [firstAction.value, ...actions] : actions
})
const missingRatio = computed(() => {
  const coverage = report.value?.coverage
  return coverage?.total_sessions ? coverage.missing_user_id_sessions / coverage.total_sessions : null
})
const emptyDescription = computed(() => {
  if (report.value?.cohort_start === report.value?.cohort_end) {
    return 'RUM retention leaves no full weeks for this report yet.'
  }
  if (missingRatio.value === 1) {
    return 'Send stable pseudonymous user IDs with your RUM events to measure return visits.'
  }
  return 'Cohorts appear after the first recorded week of activity with user IDs ends.'
})

watch([() => props.appName, activeTenant, firstAction, retry], async ([appName, tenant, action], previous, onCleanup) => {
  if (appName !== previous?.[0] || tenant !== previous?.[1]) report.value = undefined
  const controller = new AbortController()
  onCleanup(() => controller.abort())
  loading.value = true
  error.value = false
  selected.value = undefined
  try {
    const data = await api.rumCohorts(appName, action, controller.signal)
    if (controller.signal.aborted) return
    report.value = data
    const latestWithReturns = [...data.cohorts].reverse().find(cohort => cohort.returned[0] != null)
    if (latestWithReturns) selectWeek(latestWithReturns, 1)
  } catch {
    if (!controller.signal.aborted) error.value = true
  } finally {
    if (!controller.signal.aborted) loading.value = false
  }
}, { immediate: true })

function setAction(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  void router.replace({ query: { ...route.query, firstAction: value || undefined } })
}

function selectWeek(cohort: RumCohort, week: number) {
  selected.value = { weekStart: cohort.week_start, week }
}

const selectedDetail = computed(() => {
  const cell = selected.value
  const cohort = report.value?.cohorts.find(row => row.week_start === cell?.weekStart)
  if (!cell || !cohort) return null
  const count = cohort.returned[cell.week - 1]
  if (count == null) return null
  const start = Date.parse(cohort.week_start) + cell.week * 7 * dayMs
  return {
    label: `${dateFormat.format(new Date(cohort.week_start))} cohort · Week ${cell.week}`,
    users: `${numberFormat.format(count)} of ${numberFormat.format(cohort.new_users)} users returned`,
    days: `${dateFormat.format(start)} to ${dateFormat.format(start + 6 * dayMs)}`,
  }
})

function weekValue(cohort: RumCohort, count: number) {
  return percentFormat.format(count / cohort.new_users)
}

function heat(cohort: RumCohort, count: number) {
  return heatStops[Math.min(heatStops.length - 1, Math.floor(10 * count / cohort.new_users))]
}

function cellLabel(cohort: RumCohort, week: number, count: number) {
  return `${dateFormat.format(new Date(cohort.week_start))} cohort, Week ${week}, ${weekValue(cohort, count)}, ${numberFormat.format(count)} of ${numberFormat.format(cohort.new_users)} users returned`
}
</script>

<template>
  <RumAppLayout :app-name="appName">
    <section class="rum-cohorts" aria-labelledby="returning-users-title">
      <header class="report-header">
        <h2 id="returning-users-title">Returning users</h2>
        <p>See how many users return in each week after Rush first observes them.</p>
      </header>

      <div class="report-controls">
        <div class="action-filter">
          <label for="rum-cohort-action">First action</label>
          <select id="rum-cohort-action" class="report-control" :value="firstAction" :disabled="!report" @change="setAction">
            <option value="">All first actions</option>
            <option v-for="action in actionOptions" :key="action" :value="action">{{ action }}</option>
          </select>
          <span class="filter-hint">First named custom event in the user's first observed week</span>
        </div>

        <div v-if="report" class="identity-coverage" aria-label="Session identity coverage">
          <span class="identity-title">User ID coverage</span>
          <span class="identity-dates">{{ dateFormat.format(new Date(report.coverage_start)) }} to {{ dateFormat.format(new Date(report.as_of)) }} · UTC</span>
          <template v-if="missingRatio !== null">
            <div
              class="coverage-meter"
              role="meter"
              aria-label="Sessions missing a user ID"
              :aria-valuenow="missingRatio * 100"
              :aria-valuetext="percentFormat.format(missingRatio)"
            >
              <span :style="{ width: ((1 - missingRatio) * 100) + '%' }"></span>
            </div>
            <p>
              <strong>{{ percentFormat.format(missingRatio) }}</strong> of sessions missing a user ID
              <span class="coverage-count"> · {{ numberFormat.format(report.coverage.missing_user_id_sessions) }} of {{ numberFormat.format(report.coverage.total_sessions) }}</span>
            </p>
          </template>
          <p v-else>No sessions in this window</p>
        </div>
      </div>

      <section class="card retention-panel" aria-labelledby="weekly-retention-title" :aria-busy="loading">
        <header class="retention-header">
          <h3 id="weekly-retention-title">Weekly retention</h3>
          <span v-if="report">As of {{ dateFormat.format(new Date(report.as_of)) }} · UTC</span>
        </header>

        <EmptyState v-if="loading" title="Loading cohorts…" tone="loading" compact />
        <EmptyState v-else-if="error" title="Could not load cohorts" tone="error" compact>
          <template #action><button class="report-control retry-button" type="button" @click="retry++">Retry</button></template>
        </EmptyState>
        <EmptyState
          v-else-if="!report?.cohorts.length"
          :title="firstAction ? 'No cohorts for this action' : 'No weekly cohorts yet'"
          :description="firstAction ? 'Choose another first action or view all first actions.' : emptyDescription"
          compact
        />

        <template v-else>
          <DataTable class="retention-table" bare>
            <caption class="cohort-caption">Each row shows users first observed in that week and the share who returned in later weeks.</caption>
            <thead>
              <tr>
                <th scope="col" class="cohort-date-header">First seen</th>
                <th scope="col" class="data-table-col-right cohort-count">New users</th>
                <th v-for="week in followUpWeeks" :key="week" scope="col" class="cohort-week-header">Week {{ week }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cohort in report.cohorts" :key="cohort.week_start">
                <th scope="row" class="cohort-date"><time :datetime="cohort.week_start">{{ dateFormat.format(new Date(cohort.week_start)) }}</time></th>
                <td class="data-table-col-right cohort-count">{{ numberFormat.format(cohort.new_users) }}</td>
                <td v-for="(count, index) in cohort.returned" :key="index" class="retention-cell">
                  <button
                    v-if="count !== null"
                    type="button"
                    class="retention-value"
                    :style="{ '--heat': heat(cohort, count) + '%' }"
                    :aria-pressed="selected?.weekStart === cohort.week_start && selected?.week === index + 1"
                    :aria-label="cellLabel(cohort, index + 1, count)"
                    @click="selectWeek(cohort, index + 1)"
                  >{{ weekValue(cohort, count) }}</button>
                  <span v-else class="incomplete-week" title="Week not complete"><span aria-hidden="true">—</span><span class="cohort-caption">Week not complete</span></span>
                </td>
              </tr>
            </tbody>
          </DataTable>

          <div v-if="selectedDetail" class="retention-readout" role="status">
            <strong>{{ selectedDetail.label }}</strong>
            <span>{{ selectedDetail.users }} · {{ selectedDetail.days }}</span>
          </div>
          <footer class="retention-footer">
            <span>Weeks start Monday · — Week still open or in the future</span>
            <span class="retention-legend">
              0%
              <span class="heat-swatches" aria-hidden="true">
                <span v-for="stop in heatStops" :key="stop" :style="{ '--heat': stop + '%' }"></span>
              </span>
              50%+
            </span>
          </footer>
        </template>
      </section>
      <p class="history-note">First seen is based on retained RUM data. Each identified user counts once per week.</p>
    </section>
  </RumAppLayout>
</template>

<style scoped src="../styles/views/RumCohortsView.css"></style>
