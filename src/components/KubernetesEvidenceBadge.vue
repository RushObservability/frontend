<script setup lang="ts">
import { computed } from 'vue'
import { evidenceLabel, type KubernetesEvidenceKind } from '../lib/kubernetesAccess'

const props = withDefaults(defineProps<{
  kind: KubernetesEvidenceKind
  compact?: boolean
}>(), {
  compact: false,
})

const label = computed(() => evidenceLabel(props.kind))
</script>

<template>
  <span class="evidence-badge" :class="[`evidence-badge--${kind}`, { 'is-compact': compact }]">
    <span class="evidence-dot" aria-hidden="true"></span>
    <span>{{ label }}</span>
  </span>
</template>

<style scoped>
.evidence-badge {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  color: var(--text-secondary);
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  line-height: 1.25;
  white-space: nowrap;
}

.evidence-badge.is-compact {
  gap: 4px;
  padding: 2px 5px;
  font-size: 10px;
}

.evidence-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  background: var(--text-muted);
  border-radius: 50%;
}

.evidence-badge--gateway .evidence-dot { background: var(--ok); }
.evidence-badge--kubernetes_audit .evidence-dot { background: var(--amber); }
.evidence-badge--rush_cli .evidence-dot { background: var(--accent, #5b8def); }
.evidence-badge--ip_derived .evidence-dot { background: var(--warning); }
.evidence-badge--user_provided .evidence-dot { background: var(--text-secondary); }
</style>
