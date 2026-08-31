<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'

const props = defineProps<{ code: string }>()
const api = useApi()
const router = useRouter()
const { user } = useAuth()

const loading = ref(true)
const approving = ref(false)
const approved = ref(false)
const error = ref('')
const cluster = ref('')
const approvalExpiresAt = ref('')
const credentialTtlSeconds = ref(0)
const credentialExpiresAt = ref('')
const closeCountdown = ref(60)
const closeAttempted = ref(false)
let closeTimer: number | undefined

const normalizedCode = computed(() => props.code.trim().toUpperCase())
const displayCode = computed(() => {
  const code = normalizedCode.value
  return code.length === 16 ? `${code.slice(0, 8)} ${code.slice(8)}` : code
})
const ttlLabel = computed(() => {
  const minutes = Math.round(credentialTtlSeconds.value / 60)
  if (minutes < 60) return `${minutes} minutes`
  const hours = minutes / 60
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
})

function localTime(value: string): string {
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function stopCloseTimer() {
  if (closeTimer !== undefined) {
    window.clearInterval(closeTimer)
    closeTimer = undefined
  }
}

function startCloseTimer() {
  stopCloseTimer()
  closeCountdown.value = 60
  closeAttempted.value = false
  const closesAt = Date.now() + 60_000
  closeTimer = window.setInterval(() => {
    closeCountdown.value = Math.max(0, Math.ceil((closesAt - Date.now()) / 1000))
    if (closeCountdown.value > 0) return
    stopCloseTimer()
    closeAttempted.value = true
    window.close()
  }, 250)
}

onBeforeUnmount(stopCloseTimer)

onMounted(async () => {
  if (!/^[A-F0-9]{16}$/.test(normalizedCode.value)) {
    error.value = 'This kubectl login link is invalid.'
    loading.value = false
    return
  }
  try {
    const details = await api.getKubernetesLoginDetails(normalizedCode.value)
    cluster.value = details.cluster_id
    approvalExpiresAt.value = details.approval_expires_at
    credentialTtlSeconds.value = details.credential_ttl_seconds
    approved.value = details.status === 'approved'
    if (approved.value) startCloseTimer()
  } catch (cause: any) {
    error.value = cause?.message || 'This kubectl login request is unavailable or expired.'
  } finally {
    loading.value = false
  }
})

async function approve() {
  approving.value = true
  error.value = ''
  try {
    const result = await api.approveKubernetesLogin(normalizedCode.value)
    cluster.value = result.cluster_id
    credentialExpiresAt.value = result.credential_expires_at
    approved.value = true
    startCloseTimer()
  } catch (cause: any) {
    error.value = cause?.message || 'kubectl access could not be approved.'
  } finally {
    approving.value = false
  }
}
</script>

<template>
  <main class="kubectl-login-page">
    <section class="kubectl-login-card" aria-labelledby="kubectl-login-title">
      <div class="kubectl-login-header">
        <img src="/logo-mark.svg" alt="Rush" class="kubectl-login-logo" />
        <p class="kubectl-login-brand">Rush <span>Observability</span></p>
      </div>

      <div v-if="loading" class="kubectl-login-state" role="status">
        <span class="kubectl-login-spinner"></span>
        Checking request…
      </div>

      <template v-else-if="error && !cluster">
        <h1 id="kubectl-login-title">Request unavailable</h1>
        <p class="kubectl-login-lede">This link is invalid, expired, or no longer available.</p>
        <div class="kubectl-login-error" role="alert">{{ error }}</div>
      </template>

      <template v-else-if="approved">
        <div class="approval-mark" aria-hidden="true">✓</div>
        <h1 id="kubectl-login-title">Access approved</h1>
        <p class="kubectl-login-lede">
          kubectl can now connect to <strong>{{ cluster }}</strong>. Return to your terminal to continue.
        </p>
        <dl class="request-facts approved-facts">
          <div>
            <dt>Signed in as</dt>
            <dd>{{ user?.username || 'Rush user' }}</dd>
          </div>
          <div v-if="credentialExpiresAt">
            <dt>Expires</dt>
            <dd>{{ localTime(credentialExpiresAt) }}</dd>
          </div>
        </dl>
        <p class="auto-close-note">
          <template v-if="closeAttempted">You can close this tab.</template>
          <template v-else>This tab will close in <strong>{{ closeCountdown }}s</strong>.</template>
        </p>
      </template>

      <template v-else>
        <h1 id="kubectl-login-title">Approve kubectl access</h1>
        <p class="kubectl-login-lede">
          Allow <strong>{{ user?.username || 'your Rush account' }}</strong> to connect to
          <strong>{{ cluster || 'this cluster' }}</strong>.
        </p>

        <dl class="request-facts">
          <div>
            <dt>Cluster</dt>
            <dd>{{ cluster || 'Unavailable' }}</dd>
          </div>
          <div>
            <dt>Access window</dt>
            <dd>{{ ttlLabel }}</dd>
          </div>
          <div>
            <dt>Request code</dt>
            <dd class="request-code">{{ displayCode }}</dd>
          </div>
          <div>
            <dt>Approve by</dt>
            <dd>{{ localTime(approvalExpiresAt) }}</dd>
          </div>
        </dl>

        <div v-if="error" class="kubectl-login-error" role="alert">{{ error }}</div>

        <div class="kubectl-login-actions">
          <button class="approve-action" type="button" :disabled="approving || !cluster" @click="approve">
            <span v-if="approving" class="kubectl-login-spinner"></span>
            <span v-else>Approve access</span>
          </button>
          <button class="secondary-action" type="button" @click="router.push('/')">Cancel</button>
        </div>
      </template>

      <div v-if="!loading && error && approved" class="kubectl-login-error" role="alert">{{ error }}</div>
    </section>
  </main>
</template>

<style scoped>
.kubectl-login-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--sp-5);
  color: var(--text-primary);
  background-color: var(--bg-root);
  background-image: radial-gradient(circle, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
  overflow-y: auto;
}

.kubectl-login-card {
  width: 100%;
  max-width: 420px;
  padding: var(--sp-8);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}

.kubectl-login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-8);
}

.kubectl-login-logo { width: auto; height: 32px; opacity: .9; }
.kubectl-login-brand { margin: 0; color: var(--text-primary); font: 600 18px var(--font-mono); letter-spacing: -.03em; }
.kubectl-login-brand span { color: var(--text-muted); font-weight: 400; }

h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: -.02em; line-height: 1.25; }
.kubectl-login-lede { margin: var(--sp-2) 0 var(--sp-5); color: var(--text-secondary); font-size: 13px; line-height: 1.55; }
.kubectl-login-lede strong { color: var(--text-primary); font-weight: 650; }

.request-facts { margin: 0 0 var(--sp-5); padding: 0 var(--sp-3); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: var(--r-md); }
.request-facts > div { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: var(--sp-3); align-items: baseline; padding: 10px 0; }
.request-facts > div + div { border-top: 1px solid var(--border-subtle); }
.request-facts dt { color: var(--text-muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
.request-facts dd { margin: 0; overflow-wrap: anywhere; color: var(--text-primary); font-size: 12px; line-height: 1.45; text-align: right; }
.request-facts .request-code { font-family: var(--font-mono); font-weight: 650; letter-spacing: .06em; }
.approved-facts { margin-top: var(--sp-5); }
.auto-close-note { display: flex; min-height: 36px; align-items: center; justify-content: center; margin: 0; padding: var(--sp-2) var(--sp-3); color: var(--text-muted); background: var(--bg-raised); border: 1px solid var(--border-subtle); border-radius: var(--r-md); font-size: 12px; }
.auto-close-note strong { margin-left: 4px; color: var(--text-primary); font-family: var(--font-mono); font-weight: 650; }

.kubectl-login-error { margin: 0 0 var(--sp-4); padding: 10px 12px; color: var(--error); background: var(--error-dim); border: 1px solid color-mix(in srgb, var(--error) 30%, transparent); border-radius: var(--r-sm); font-size: 12px; line-height: 1.5; }
.kubectl-login-actions { display: flex; flex-direction: column; gap: var(--sp-2); }
.approve-action, .secondary-action { display: flex; width: 100%; height: 36px; align-items: center; justify-content: center; padding: var(--sp-2) var(--sp-4); border-radius: var(--r-md); font: 600 13px var(--font-ui); cursor: pointer; }
.approve-action { color: var(--text-inverse); background: var(--amber); border: 1px solid var(--amber); }
.approve-action:hover:not(:disabled) { background: var(--amber-hover); }
.approve-action:disabled { opacity: .6; cursor: not-allowed; }
.secondary-action { color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-default); }
.secondary-action:hover { color: var(--text-primary); border-color: var(--amber); }
.approve-action:focus-visible, .secondary-action:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; }

.approval-mark { display: grid; width: 38px; height: 38px; margin: 0 0 var(--sp-4); place-items: center; color: var(--ok); background: var(--ok-dim); border: 1px solid color-mix(in srgb, var(--ok) 36%, transparent); border-radius: 50%; font-size: 18px; }
.kubectl-login-state { display: flex; min-height: 120px; align-items: center; justify-content: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
.kubectl-login-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: kubectl-login-spin .7s linear infinite; }
@keyframes kubectl-login-spin { to { transform: rotate(360deg); } }

@media (max-width: 480px) {
  .kubectl-login-page { align-items: flex-start; padding: var(--sp-3); }
  .kubectl-login-card { margin: var(--sp-5) 0; padding: var(--sp-6); }
  .request-facts > div { grid-template-columns: 1fr; gap: 3px; }
  .request-facts dd { text-align: left; }
}

@media (prefers-reduced-motion: reduce) {
  .kubectl-login-spinner { animation-duration: 1.6s; }
}
</style>
