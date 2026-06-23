<script setup lang="ts">
import { useRouter } from 'vue-router'
import MonitorWizard from '../components/MonitorWizard.vue'

const router = useRouter()

function onSaved() {
  router.push('/alerts')
}

function onCancel() {
  router.push('/alerts')
}
</script>

<template>
  <div class="monitor-create-page">
    <!-- Header with back link -->
    <div class="mcp-header">
      <router-link to="/alerts" class="mcp-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Monitors
      </router-link>
      <h1 class="mcp-title">New Monitor</h1>
      <p class="mcp-sub">Define what to watch, when to alert, and who to notify.</p>
    </div>

    <!-- Amber divider -->
    <div class="mcp-divider"></div>

    <!-- The form -->
    <MonitorWizard @saved="onSaved" @cancel="onCancel" />
  </div>
</template>

<style scoped>
.monitor-create-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--sp-4) var(--sp-4) var(--sp-8);
}

.mcp-header {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}

.mcp-back {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.12s;
  width: fit-content;
}
.mcp-back:hover { color: var(--amber); }

.mcp-title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  line-height: 1.1;
}

.mcp-sub {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.mcp-divider {
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
