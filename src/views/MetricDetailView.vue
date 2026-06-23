<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import type { LabelBreakdownResponse, LabelCardinality } from '../types'

const route = useRoute()
const router = useRouter()
const api = useApi()

const metricName = computed(() => route.params.metricName as string)

const breakdown = ref<LabelBreakdownResponse | null>(null)
const loading = ref(false)

onMounted(() => loadBreakdown())

async function loadBreakdown() {
  loading.value = true
  try {
    breakdown.value = await api.getLabelBreakdown(metricName.value)
  } catch { breakdown.value = null }
  finally { loading.value = false }
}

const breakdownTotal = computed(() => {
  if (!breakdown.value) return 0
  return breakdown.value.labels.reduce((s, l) => s + l.unique_values, 0)
})

function treemapPct(label: LabelCardinality): number {
  if (!breakdownTotal.value) return 0
  return (label.unique_values / breakdownTotal.value) * 100
}

const treemapColors = [
  '#e2884d', '#5b8dd9', '#4caf7c', '#d4605a', '#9c6ade',
  '#e0a030', '#47a3a3', '#c45ea0', '#7c8ea0', '#6bbf6b',
]

function goBack() {
  router.push({ path: '/settings', hash: '#stats' })
}
</script>

<template>
  <div class="metric-detail">
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <button class="bc-link" @click="goBack">&larr; Stats / Metrics</button>
    </div>

    <!-- Header -->
    <div class="detail-header">
      <div class="header-left">
        <h1 class="metric-name mono">{{ metricName }}</h1>
        <div class="metric-meta" v-if="breakdown">
          <span class="meta-badge">{{ breakdown.total_series.toLocaleString() }} series</span>
          <span class="meta-badge">{{ breakdown.labels.length }} labels</span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">Loading metric details...</div>

    <template v-if="breakdown">
      <!-- Label Cardinality Section -->
      <section class="section">
        <h2 class="section-title">Label Cardinality</h2>
        <p class="section-desc">How each label contributes to the total series count. High-cardinality labels drive storage and query cost.</p>

        <!-- Treemap -->
        <div class="treemap" v-if="breakdown.labels.length > 0">
          <div
            v-for="(label, j) in breakdown.labels" :key="label.label_key"
            class="treemap-block"
            :style="{
              flexGrow: label.unique_values,
              background: treemapColors[j % treemapColors.length],
            }"
          >
            <div class="treemap-label">{{ label.label_key }}</div>
            <div class="treemap-value">{{ label.unique_values }}</div>
            <div class="treemap-pct">{{ treemapPct(label).toFixed(0) }}%</div>
          </div>
        </div>

        <!-- Label table -->
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Label</th>
                <th class="num">Unique Values</th>
                <th>Share</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(label, j) in breakdown.labels" :key="label.label_key">
                <td><span class="label-dot" :style="{ background: treemapColors[j % treemapColors.length] }"></span></td>
                <td class="mono cell-name">{{ label.label_key }}</td>
                <td class="num">{{ label.unique_values.toLocaleString() }}</td>
                <td>
                  <div class="share-bar-wrap">
                    <div class="share-bar" :style="{ width: treemapPct(label) + '%', background: treemapColors[j % treemapColors.length] }"></div>
                    <span class="share-text">{{ treemapPct(label).toFixed(1) }}%</span>
                  </div>
                </td>
                <td>
                  <span class="status-badge status-active">active</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Metric Rules Section (placeholder for firewalling) -->
      <section class="section">
        <h2 class="section-title">Metric Rules</h2>
        <p class="section-desc">Control which label combinations are ingested. Drop high-cardinality labels or filter specific values to reduce cost.</p>
        <div class="rules-empty card">
          <div class="rules-empty-icon">&#9881;</div>
          <div class="rules-empty-text">No rules configured for this metric.</div>
          <div class="rules-empty-hint">Rules let you drop labels, aggregate series, or block specific label values before ingestion.</div>
        </div>
      </section>

      <!-- Metric Info Section -->
      <section class="section">
        <h2 class="section-title">Metric Info</h2>
        <div class="info-grid">
          <div class="info-card card">
            <div class="info-label">Total Series</div>
            <div class="info-value mono">{{ breakdown.total_series.toLocaleString() }}</div>
          </div>
          <div class="info-card card">
            <div class="info-label">Label Count</div>
            <div class="info-value mono">{{ breakdown.labels.length }}</div>
          </div>
          <div class="info-card card">
            <div class="info-label">Highest Cardinality Label</div>
            <div class="info-value mono" v-if="breakdown.labels.length > 0">
              {{ breakdown.labels[0]?.label_key }}
              <span class="info-sub">({{ breakdown.labels[0]?.unique_values }} values)</span>
            </div>
            <div class="info-value mono" v-else>-</div>
          </div>
        </div>
      </section>
    </template>

    <!-- No data -->
    <div v-if="!loading && !breakdown" class="empty-state card">
      <div class="empty-state-icon">&#9651;</div>
      <div>No cardinality data found for this metric.</div>
    </div>
  </div>
</template>

<style scoped src="../styles/views/MetricDetailView.css"></style>
