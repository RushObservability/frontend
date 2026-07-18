<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuth } from '../composables/useAuth'
import { useApi } from '../composables/useApi'

const router = useRouter()
const route = useRoute()
const { login } = useAuth()
const api = useApi()

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)
const sessionExpired = computed(() => route.query.expired === '1')

// SSO status
const ssoEnabled = ref(false)
const ssoProviderName = ref('')

onMounted(async () => {
  try {
    const status = await api.getSsoStatus()
    ssoEnabled.value = status.enabled
    ssoProviderName.value = status.provider_name
  } catch {
    // SSO status endpoint may not exist yet — no SSO
  }
})

async function handleSubmit() {
  error.value = ''
  if (!username.value || !password.value) {
    error.value = 'Username and password are required.'
    return
  }
  submitting.value = true
  try {
    await login(username.value, password.value)
    const raw = (route.query.redirect as string) || '/'
    // Validate redirect is same-origin using URL parsing to prevent open redirect,
    // including protocol-relative (//evil.com) and javascript: URI bypasses.
    let redirect = '/'
    try {
      const resolved = new URL(raw, window.location.origin)
      if (resolved.origin === window.location.origin) {
        redirect = resolved.pathname + resolved.search + resolved.hash
      }
    } catch { /* malformed URL — keep default '/' */ }
    router.replace(redirect)
  } catch (e: any) {
    if (e.message?.includes('401')) {
      error.value = 'Invalid username or password.'
    } else {
      error.value = e.message || 'Login failed. Please try again.'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-header">
        <img src="/logo-mark.svg" alt="Rush" class="login-logo" />
        <h1 class="login-title">Rush <span class="login-title-dim">Observability</span></h1>
      </div>

      <div v-if="sessionExpired" class="login-notice" role="status">
        Your session expired. Sign in again to continue.
      </div>

      <!-- SSO Button -->
      <div v-if="ssoEnabled" class="sso-section">
        <a href="/auth/sso/login" class="sso-btn">
          Sign in with {{ ssoProviderName || 'SSO' }}
        </a>
        <div class="sso-divider">
          <span class="sso-divider-line"></span>
          <span class="sso-divider-text">or sign in locally</span>
          <span class="sso-divider-line"></span>
        </div>
      </div>

      <form class="login-form" @submit.prevent="handleSubmit">
        <div class="login-field">
          <label class="login-label" for="username">Username</label>
          <input
            id="username"
            v-model="username"
            type="text"
            class="login-input"
            autocomplete="username"
            autofocus
            placeholder="Enter your username"
          />
        </div>

        <div class="login-field">
          <label class="login-label" for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="login-input"
            autocomplete="current-password"
            placeholder="Enter your password"
          />
        </div>

        <div v-if="error" class="login-error">{{ error }}</div>

        <button type="submit" class="login-btn" :disabled="submitting">
          <span v-if="submitting" class="login-spinner"></span>
          <span v-else>Sign in</span>
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-root);
  background-image: radial-gradient(circle, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
}

.login-card {
  width: 100%;
  max-width: 360px;
  padding: var(--sp-8);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-lg);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}

.login-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-8);
}

.login-notice {
  margin: calc(var(--sp-4) * -1) 0 var(--sp-5);
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warning) 32%, transparent);
  border-radius: var(--r-sm);
  color: var(--text-primary);
  background: color-mix(in srgb, var(--warning) 9%, var(--bg-raised));
  font-size: 12px;
  line-height: 1.45;
}

.login-logo {
  height: 32px;
  width: auto;
  opacity: 0.9;
}

.login-title {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.03em;
  color: var(--text-primary);
}

.login-title-dim {
  color: var(--text-muted);
  font-weight: 400;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
}

.login-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.login-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.login-input {
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.login-input::placeholder {
  color: var(--text-muted);
}

.login-input:focus {
  border-color: var(--amber);
  box-shadow: 0 0 0 2px var(--amber-dim);
}

.login-error {
  font-size: 12px;
  color: var(--error);
  padding: var(--sp-2) var(--sp-3);
  background: var(--error-dim);
  border-radius: var(--r-sm);
  border: 1px solid rgba(229, 88, 79, 0.15);
}

.login-btn {
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-4);
  background: var(--amber);
  color: var(--text-inverse);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
}

.login-btn:hover:not(:disabled) {
  background: var(--amber-hover);
}

.login-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.sso-section {
  display: flex;
  flex-direction: column;
  gap: var(--sp-4);
  margin-bottom: var(--sp-2);
}

.sso-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 36px;
  padding: var(--sp-2) var(--sp-4);
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  color: var(--text-primary);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.sso-btn:hover {
  background: var(--bg-surface);
  border-color: var(--amber);
}

.sso-divider {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.sso-divider-line {
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}

.sso-divider-text {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}
</style>
