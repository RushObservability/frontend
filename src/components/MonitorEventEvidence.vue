<script setup lang="ts">
import { computed } from 'vue'
import type { MonitorEvent } from '../types'
import { alertEvidenceLink, evidenceFilters, evidenceSignal, formatEvidenceReading, formatEvidenceThreshold, formatEvidenceTime, formatRuleVersion } from '../lib/alertEvidence'

const props = defineProps<{ event: MonitorEvent; currentVersion?: number }>()
const evidence = computed(() => props.event.evidence)
const explore = computed(() => alertEvidenceLink(props.event))
const filters = computed(() => evidence.value ? evidenceFilters(evidence.value.query) : [])
const queryText = computed(() => {
  const query = evidence.value?.query
  if (query?.kind === 'promql') return query.expression
  if (query?.kind === 'composite') return query.formula
  return ''
})
const currentVersionLabel = computed(() => evidence.value && props.currentVersion !== undefined
  && props.currentVersion !== evidence.value.rule_version ? formatRuleVersion(props.currentVersion) : null)
</script>

<template>
  <section class="alert-evidence" aria-label="Saved evaluation evidence">
    <header class="evidence-header">
      <div>
        <h3>Saved evaluation</h3>
        <p v-if="evidence" class="text-muted">{{ evidence.rule_name }} <span aria-hidden="true">·</span> {{ evidenceSignal(evidence.query) }}</p>
      </div>
      <router-link v-if="explore" :to="explore" class="btn btn-sm evidence-link">
        {{ evidence?.query.kind === 'promql' ? 'Open in Metrics' : 'Open in Explore' }}
        <span aria-hidden="true">↗</span>
      </router-link>
    </header>

    <p v-if="!evidence" class="text-muted">No saved evaluation is available for this event.</p>
    <template v-else>
      <dl class="evidence-readings">
        <div>
          <dt>{{ evidence.query.kind === 'forecast' ? 'Forecast peak' : 'Observed' }}</dt>
          <dd class="mono">{{ formatEvidenceReading(event.value, evidence.query) }}</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd class="mono">{{ formatEvidenceThreshold(event) }}</dd>
        </div>
        <div>
          <dt>Rule version</dt>
          <dd :title="evidence.rule_version ? String(evidence.rule_version) : undefined">{{ formatRuleVersion(evidence.rule_version) }}</dd>
        </div>
        <div>
          <dt>{{ evidence.window_start ? 'Evaluation window' : 'Evaluated at' }}</dt>
          <dd class="mono evidence-time">
            <template v-if="evidence.window_start">
              <time :datetime="evidence.window_start">{{ formatEvidenceTime(evidence.window_start) }}</time>
              <span>to</span>
            </template>
            <time :datetime="evidence.evaluated_at">{{ formatEvidenceTime(evidence.evaluated_at) }}</time>
          </dd>
        </div>
      </dl>

      <div v-if="queryText || filters.length || evidence.group_by.length" class="evidence-scope">
        <code v-if="queryText" class="evidence-query mono">{{ queryText }}</code>
        <ul v-if="filters.length || evidence.group_by.length" class="evidence-filters" aria-label="Saved filters">
          <li v-for="(filter, index) in filters" :key="index"><code>{{ filter }}</code></li>
          <li v-if="evidence.group_by.length"><code>{{ evidence.group_by.join(', ') }} = {{ event.group_key || 'Empty value' }}</code></li>
        </ul>
      </div>
      <p v-if="currentVersionLabel" class="evidence-version-note text-muted">This event used an earlier rule version. The current rule version is {{ currentVersionLabel }}.</p>
    </template>
  </section>
</template>

<style scoped>
.alert-evidence {
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  white-space: normal;
  overflow-wrap: anywhere;
}
.evidence-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.evidence-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 700;
}
.evidence-header p { margin: 3px 0 0; }
.evidence-link { color: var(--accent); text-decoration: none; white-space: nowrap; }
.evidence-readings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 125px), 1fr));
  gap: var(--sp-2) var(--sp-4);
  margin: var(--sp-3) 0 0;
}
.evidence-readings dt {
  margin-bottom: 3px;
  color: var(--text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.evidence-readings dd { margin: 0; color: var(--text-primary); font-weight: 600; }
.evidence-readings dd.evidence-time { display: flex; flex-wrap: wrap; gap: 0 5px; font-size: 11px; font-weight: 400; }
.evidence-scope, .evidence-version-note { margin: var(--sp-3) 0 0; }
.evidence-query { display: block; white-space: pre-wrap; color: var(--text-secondary); }
.evidence-filters { display: flex; flex-wrap: wrap; gap: var(--sp-1); list-style: none; padding: 0; margin: 0; }
.evidence-query + .evidence-filters { margin-top: var(--sp-2); }
.evidence-filters li {
  max-width: 100%;
  padding: 2px 6px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 11px;
}
</style>
