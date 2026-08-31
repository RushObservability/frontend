<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import MonitorWizard from '../components/MonitorWizard.vue'

const props = defineProps<{
  id: string
}>()

const router = useRouter()
const monitorName = ref('')

function onLoaded(name: string) {
  monitorName.value = name
}

function onSaved() {
  router.push(`/alerts/${props.id}`)
}

function onCancel() {
  router.push(`/alerts/${props.id}`)
}
</script>

<template>
  <div class="monitor-edit-page">
    <div class="mep-header">
      <router-link :to="`/alerts/${id}`" class="mep-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to monitor
      </router-link>
      <div class="mep-title-row">
        <span class="mep-eyebrow mono">Edit</span>
        <h1 class="mep-title">{{ monitorName || 'Monitor' }}</h1>
      </div>
      <p class="mep-sub">Adjust the query, thresholds, and notification routing.</p>
    </div>

    <div class="mep-divider"></div>

    <MonitorWizard :monitorId="id" @loaded="onLoaded" @saved="onSaved" @cancel="onCancel" />
  </div>
</template>

<style scoped>
.monitor-edit-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--sp-4) var(--sp-4) var(--sp-8);
}

.mep-header {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}

.mep-back {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.12s;
  width: fit-content;
}
.mep-back:hover { color: var(--amber); }

.mep-title-row {
  display: flex;
  align-items: baseline;
  gap: var(--sp-3);
  flex-wrap: wrap;
}

.mep-eyebrow {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--amber);
  padding: 3px 8px;
  border: 1px solid var(--amber-glow);
  border-radius: var(--r-sm);
  background: var(--amber-dim);
  position: relative;
  top: -2px;
}

.mep-title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  line-height: 1.1;
  min-width: 0;
  word-break: break-word;
}

.mep-sub {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.mep-divider {
  height: 1px;
  background: linear-gradient(
    90deg,
    var(--border-subtle) 0%,
    var(--amber-muted) 30%,
    var(--amber-muted) 70%,
    var(--border-subtle) 100%
  );
  margin-bottom: var(--sp-5);
}
</style>
