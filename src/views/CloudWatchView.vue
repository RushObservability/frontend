<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useApi } from '../composables/useApi'
import { apiBaseUrl } from '../config'

const api = useApi()

const origin = apiBaseUrl()
const defaultTenant = ref('')

const urlEndpoint = computed(() => `${origin}/cloudwatch/firehose/t/${defaultTenant.value || '{tenant}'}`)

const copied = ref('')
async function copy(text: string, id: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = id
    setTimeout(() => { if (copied.value === id) copied.value = '' }, 1500)
  } catch { /* clipboard unavailable */ }
}

onMounted(async () => {
  try {
    const r = await api.getCloudwatchSetting()
    defaultTenant.value = r.default_tenant || ''
  } catch { /* not admin or unavailable — leave placeholder */ }
})
</script>

<template>
  <div class="cw-view">
    <div class="cw-head">
      <h1>CloudWatch Logs</h1>
      <p class="cw-desc">
        Ingest AWS CloudWatch Logs into Rush using a Kinesis Data Firehose stream with an
        HTTP endpoint. The tenant is embedded in the endpoint URL; an access key is optional.
      </p>
    </div>

    <section class="cw-card">
      <h2>Firehose endpoint URL</h2>
      <p>
        Use this as the Firehose HTTP endpoint URL — the <code>{tenant}</code> segment selects
        the tenant. An access key is <strong>optional</strong>: you may set one on the Firehose
        stream for defense-in-depth, but it isn't required and doesn't affect tenant routing.
      </p>
      <div class="cw-code">
        <code>{{ urlEndpoint }}</code>
        <button class="btn btn-sm" @click="copy(urlEndpoint, 'b')">{{ copied === 'b' ? 'Copied' : 'Copy' }}</button>
      </div>
    </section>

    <section class="cw-card">
      <h2>AWS setup</h2>
      <ol>
        <li>Create a Kinesis Data Firehose delivery stream with an <strong>HTTP endpoint</strong> destination set to the URL above. An access key is optional.</li>
        <li>On each target log group, create a <strong>CloudWatch Logs subscription filter</strong> whose destination is that Firehose stream.</li>
      </ol>
      <p class="cw-note">Logs arrive as gzip + base64 CloudWatch records; Rush decodes them automatically.</p>
    </section>
  </div>
</template>

<style scoped>
.cw-view { padding: 1.5rem; max-width: 820px; color: var(--text-primary); }
.cw-head h1 { margin: 0 0 0.5rem; }
.cw-desc { color: var(--text-secondary); margin: 0 0 1.5rem; }
.cw-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
}
.cw-card h2 { margin: 0 0 0.5rem; font-size: 1.05rem; }
.cw-card p { margin: 0 0 0.75rem; color: var(--text-secondary); }
.cw-code {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font-family: var(--font-mono, ui-monospace, monospace);
}
.cw-code code { flex: 1; word-break: break-all; color: var(--text-primary); }
.cw-note { color: var(--text-muted); font-size: 0.85rem; }
.btn-sm { padding: 0.25rem 0.6rem; font-size: 0.8rem; }
ol { margin: 0 0 0.75rem; padding-left: 1.25rem; }
ol li { margin-bottom: 0.4rem; }
</style>
