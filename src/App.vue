<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAuth } from './composables/useAuth'
import { useTenant } from './composables/useTenant'
import { useFeatures } from './composables/useFeatures'
import { useLicense } from './composables/useLicense'
import { availableAddons } from './integrations/catalog'
import { isAddonEnabled } from './composables/useIntegrationEnabled'
import { onSessionExpired } from './composables/authSession'
import { removeLegacyStorageKey, storageUserId, userScopedStorageKey } from './composables/storageScope'
import AppNavigation from './components/AppNavigation.vue'
import CommandPalette from './components/CommandPalette.vue'
import { visibleNavigationGroups } from './navigation'
import { defaultTheme } from './config'

const route = useRoute()
const router = useRouter()
const {
  user,
  isAuthenticated,
  isAdmin,
  checked,
  sessionActivityIntervalMs,
  checkSession,
  refreshSession,
  logout,
} = useAuth()
const { tenants, activeTenantName, showSwitcher, loadTenants, setTenant, activeTenant } = useTenant()
const usesBareLayout = computed(() => route.name === 'login' || route.meta.bareLayout === true)

// A saved preference always wins; otherwise fall back to the deploy default
// (DEFAULT_THEME env var, defaults to light when unset).
const THEME_STORAGE_KEY = 'rush-theme'
removeLegacyStorageKey(THEME_STORAGE_KEY)
const theme = ref<'dark' | 'light'>(defaultTheme())
const appEnv = import.meta.env.MODE

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

const { features, loadFeatures } = useFeatures()
const { loadLicense, hasEntitlement } = useLicense()
const featureOn = (k: string) => !!(features.value as Record<string, boolean | undefined>)[k]
const hasIntegrations = computed(() => availableAddons(hasEntitlement, featureOn, isAddonEnabled).length > 0)
const navigationGroups = computed(() => visibleNavigationGroups({
  isAdmin: isAdmin.value,
  features: features.value,
  hasIntegrations: hasIntegrations.value,
}))

const userMenuOpen = ref(false)
const tenantMenuOpen = ref(false)
const paletteOpen = ref(false)

function onGlobalKeydown(e: KeyboardEvent) {
  onSessionActivity()
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
}

let lastSessionActivityTouch = Date.now()

function onSessionActivity() {
  if (!isAuthenticated.value || document.visibilityState === 'hidden') return
  const now = Date.now()
  if (now - lastSessionActivityTouch < sessionActivityIntervalMs.value) return
  lastSessionActivityTouch = now
  void refreshSession().catch(() => {
    // A transient network failure should not suppress the next activity check.
    lastSessionActivityTouch = 0
  })
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') onSessionActivity()
}

function toggleUserMenu() {
  userMenuOpen.value = !userMenuOpen.value
  tenantMenuOpen.value = false
}


function toggleTenantMenu() {
  tenantMenuOpen.value = !tenantMenuOpen.value
  userMenuOpen.value = false
}

function selectTenant(id: string) {
  tenantMenuOpen.value = false
  setTenant(id)
}

// Close dropdowns on click-outside
function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (tenantMenuOpen.value && !target.closest('.tenant-menu-wrap')) {
    tenantMenuOpen.value = false
  }
  if (userMenuOpen.value && !target.closest('.user-menu-wrap')) {
    userMenuOpen.value = false
  }
}

let stopSessionExpired: (() => void) | undefined
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onGlobalKeydown)
  document.addEventListener('pointerdown', onSessionActivity, { passive: true })
  document.addEventListener('wheel', onSessionActivity, { passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  stopSessionExpired = onSessionExpired(() => {
    userMenuOpen.value = false
    tenantMenuOpen.value = false
    paletteOpen.value = false
    if (route.name === 'login') return
    // Match the route guard's privacy behavior: retain only the path, never a
    // potentially sensitive observability query string.
    void router.replace({
      name: 'login',
      query: { redirect: route.path, expired: '1' },
    })
  })
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onGlobalKeydown)
  document.removeEventListener('pointerdown', onSessionActivity)
  document.removeEventListener('wheel', onSessionActivity)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopSessionExpired?.()
})

async function handleLogout() {
  userMenuOpen.value = false
  await logout()
  router.push({ name: 'login' })
}

watch(theme, (t) => {
  document.documentElement.setAttribute('data-theme', t)
}, { immediate: true })

watch(storageUserId, (userId) => {
  const key = userScopedStorageKey(THEME_STORAGE_KEY, userId)
  let stored: string | null = null
  try { stored = key ? localStorage.getItem(key) : null } catch { /* storage may be unavailable */ }
  if (stored === 'dark' || stored === 'light') theme.value = stored
  else if (!userId) theme.value = defaultTheme()
}, { immediate: true })

watch([theme, storageUserId], ([t, userId]) => {
  const key = userScopedStorageKey(THEME_STORAGE_KEY, userId)
  if (!key) return
  try { localStorage.setItem(key, t) } catch { /* storage may be unavailable */ }
})

onMounted(async () => {
  document.documentElement.setAttribute('data-theme', theme.value)
  loadFeatures()
  loadLicense()
  if (!checked.value) {
    await checkSession()
  }
})

// Load tenants whenever auth is (re)established — covers both a hard page load
// with an existing session and an SPA login (router.replace, no full reload),
// which previously left the tenant switcher empty until a manual refresh.
watch(isAuthenticated, async (authed) => {
  if (authed) {
    lastSessionActivityTouch = Date.now()
    await loadTenants()
    // Tenant validation may replace a stale localStorage value. Refresh the
    // tenant-aware feature flags after that resolution so SRE entry points do
    // not briefly reflect the wrong tenant policy.
    await loadFeatures()
  }
}, { immediate: true })
</script>

<template>
  <div class="app">
    <a v-if="!usesBareLayout" class="skip-link" href="#main-content">Skip to main content</a>
    <header v-if="!usesBareLayout" class="topbar">
      <router-link to="/" class="logo" aria-label="Rush Observability home">
        <span class="logo-icon" aria-hidden="true">R</span>
        <span class="logo-text">Rush Observability</span>
      </router-link>
      <button class="global-search" type="button" @click="paletteOpen = true" aria-label="Open global search">
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.1"/><path d="m10 10 3.2 3.2"/></svg>
        <span>Search services, traces, logs, metrics</span>
        <kbd>⌘ K</kbd>
      </button>
      <div class="topbar-right">
        <div v-if="isAuthenticated && showSwitcher" class="tenant-menu-wrap">
          <button class="tenant-menu-btn" @click="toggleTenantMenu" title="Switch tenant" aria-haspopup="menu" :aria-expanded="tenantMenuOpen">
            <span class="tenant-status-dot" aria-hidden="true"></span>
            <span class="tenant-name">{{ activeTenantName }}</span>
            <svg class="tenant-chevron" :class="{ open: tenantMenuOpen }" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div v-if="tenantMenuOpen" class="tenant-dropdown" role="menu" aria-label="Tenants">
            <div class="tenant-dropdown-header">Tenants</div>
            <div class="tenant-dropdown-divider"></div>
            <button
              v-for="t in tenants"
              :key="t.name"
              class="tenant-dropdown-item"
              role="menuitem"
              :class="{ active: t.name === activeTenant }"
              @click="selectTenant(t.name)"
            >
              <span class="tenant-dot" :class="{ visible: t.name === activeTenant }"></span>
              <span class="tenant-item-name">{{ t.name }}</span>
            </button>
          </div>
        </div>
        <button v-else class="tenant-standalone" type="button" aria-label="Active tenant">
          <span class="tenant-status-dot" aria-hidden="true"></span>
          <span class="tenant-name">{{ activeTenantName || 'default' }}</span>
        </button>
        <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'" :aria-label="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          <svg v-if="theme === 'dark'" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2"/><path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.4 3.4l.9.9M11.7 11.7l.9.9M12.6 3.4l-.9.9M4.3 11.7l-.9.9"/></svg>
          <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M11.8 10.8A5.2 5.2 0 0 1 5.2 4.2 5.2 5.2 0 1 0 11.8 10.8Z"/></svg>
        </button>
        <div v-if="appEnv !== 'production'" class="env-badge">{{ appEnv }}</div>
        <div v-if="isAuthenticated" class="user-menu-wrap">
          <button class="user-menu-btn" @click="toggleUserMenu" aria-haspopup="menu" :aria-expanded="userMenuOpen" aria-label="Open user menu">
            <span class="user-avatar">{{ user?.display_name?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || '?' }}</span>
            <span class="user-name">{{ user?.display_name || user?.username }}</span>
          </button>
          <div v-if="userMenuOpen" class="user-dropdown" role="menu" aria-label="User menu">
            <div class="user-dropdown-header">
              <span class="user-dropdown-name">{{ user?.display_name || user?.username }}</span>
              <span class="user-dropdown-role">{{ user?.role }}</span>
            </div>
            <div class="user-dropdown-divider"></div>
            <button class="user-dropdown-item" @click="handleLogout">Sign out</button>
          </div>
        </div>
      </div>
    </header>
    <div v-if="!usesBareLayout" class="app-frame">
      <AppNavigation :groups="navigationGroups" />
      <main id="main-content" class="main" tabindex="-1">
        <router-view />
      </main>
    </div>
    <router-view v-else />
    <CommandPalette v-model:open="paletteOpen" :navigation-groups="navigationGroups" />
  </div>
</template>

<style>
/* ═══════════════════════════════════════════════════════════
   Rush O11y — Design System
   "Control Room" — quiet chrome, readable signals, deliberate actions
   ═══════════════════════════════════════════════════════════ */
:root {
  /* ── Backgrounds ── */
  --bg-void:    #060710;
  --bg-root:    #0a0c14;
  --bg-surface: #0f1119;
  --bg-raised:  #151822;
  --bg-overlay: #1b1f2c;
  --bg-hover:   #212635;
  --bg-active:  #282e40;

  /* ── Borders ── */
  --border-subtle:  #1c2233;
  --border-default: #272d42;
  --border-strong:  #343b54;
  --border:         var(--border-default);

  /* ── Text (WCAG AA compliant) ── */
  --text-primary:   #dfe3ec;
  --text-secondary: #8b94aa;
  --text-muted:     #6b7490;
  --text-inverse:   #060710;

  /* ── Accent ── */
  --accent:       #3b82f6;
  --accent-soft:  rgba(59, 130, 246, 0.12);
  --accent-glow:  rgba(59, 130, 246, 0.22);
  --accent-hover: #60a5fa;
  --accent-muted: rgba(59, 130, 246, 0.5);
  --focus-ring:   var(--accent);

  /* Compatibility for view styles while they migrate to semantic tokens. */
  --amber:       var(--accent);
  --amber-dim:   var(--accent-soft);
  --amber-glow:  var(--accent-glow);
  --amber-hover: var(--accent-hover);
  --amber-muted: var(--accent-muted);

  /* ── Status ── */
  --ok:          #47b881;
  --ok-dim:      rgba(71, 184, 129, 0.10);
  --error:       #e5584f;
  --error-dim:   rgba(229, 88, 79, 0.10);
  --warning:     #eab308;
  --warning-dim: rgba(234, 179, 8, 0.10);

  /* ── Methods ── */
  --method-get:    #47b881;
  --method-post:   #5b8dd9;
  --method-put:    #3b82f6;
  --method-delete: #e5584f;
  --method-patch:  #9b7dd4;

  /* ── Typography ── */
  --font-ui:   'Figtree', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', monospace;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-md: 14px;
  --text-lg: 18px;

  /* ── Spacing ── */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 20px;
  --sp-6: 24px;
  --sp-8: 32px;

  /* ── Radius ── */
  --r-sm: 3px;
  --r-md: 5px;
  --r-lg: 8px;
  --r-pill: 10px;

  /* ── Histogram ── */
  --histogram-bar:       rgba(59, 130, 246, 0.35);
  --histogram-bar-hover: rgba(59, 130, 246, 0.65);
}

/* ═══ Light Theme ═══ */
[data-theme="light"] {
  /* ── Backgrounds ── */
  --bg-void:    #e8eaef;
  --bg-root:    #f3f4f7;
  --bg-surface: #ffffff;
  --bg-raised:  #f8f9fb;
  --bg-overlay: #eef0f4;
  --bg-hover:   #e9ebf0;
  --bg-active:  #dfe2e9;

  /* ── Borders ── */
  --border-subtle:  #e2e5eb;
  --border-default: #cdd1da;
  --border-strong:  #b4bac7;
  --border:         var(--border-default);

  /* ── Text (WCAG AA compliant) ── */
  --text-primary:   #1a1d26;
  --text-secondary: #474e63;
  --text-muted:     #636c80;
  --text-inverse:   #ffffff;

  /* ── Accent ── */
  --accent:       #2563eb;
  --accent-soft:  rgba(37, 99, 235, 0.10);
  --accent-glow:  rgba(37, 99, 235, 0.16);
  --accent-hover: #1d4ed8;
  --accent-muted: rgba(37, 99, 235, 0.5);

  /* ── Status ── */
  --ok:          #2d8e62;
  --ok-dim:      rgba(45, 142, 98, 0.10);
  --error:       #d04440;
  --error-dim:   rgba(208, 68, 64, 0.10);
  --warning:     #c89a06;
  --warning-dim: rgba(200, 154, 6, 0.10);

  /* ── Methods ── */
  --method-get:    #2d8e62;
  --method-post:   #4070c4;
  --method-put:    #2563eb;
  --method-delete: #d04440;
  --method-patch:  #7c5fbf;

  /* ── Histogram ── */
  --histogram-bar:       rgba(37, 99, 235, 0.30);
  --histogram-bar-hover: rgba(37, 99, 235, 0.55);
}

/* ═══ Reset ═══ */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-ui);
  background: var(--bg-root);
  color: var(--text-primary);
  line-height: 1.55;
  overflow-x: hidden;
}

a {
  color: var(--accent);
  text-decoration: none;
}

input, select, button {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
  background: none;
  border: none;
  outline: none;
}

button {
  cursor: pointer;
}

/* Keep keyboard focus visible across the shell, including controls whose
   component styles intentionally remove the native outline. */
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.skip-link {
  position: fixed;
  top: var(--sp-3);
  left: var(--sp-3);
  z-index: 1000;
  padding: var(--sp-2) var(--sp-3);
  color: var(--text-inverse);
  background: var(--accent);
  border-radius: var(--r-md);
  transform: translateY(-180%);
  transition: transform 120ms ease;
}

.skip-link:focus-visible { transform: translateY(0); }

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* The app contains many independently animated panels. A single global
   preference keeps reduced-motion behavior consistent as new views are added. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

.env-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  background: var(--ok-dim);
  color: var(--ok);
  border: 1px solid rgba(71, 184, 129, 0.12);
}

.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s;
}
.theme-toggle:hover {
  color: var(--accent);
  border-color: var(--border-default);
  background: var(--bg-hover);
}

/* ═══ Utilities ═══ */
.mono { font-family: var(--font-mono); }
.text-muted { color: var(--text-muted); }

/* Service-scope filter chip — shown on Alerts/SLOs/Anomaly when deep-linked
   from a service page (?service=). Click × to clear and see everything. */
.svc-scope-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: var(--sp-3);
  padding: 5px 6px 5px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 999px;
}
.svc-scope-chip .mono { color: var(--text-primary); font-weight: 600; }
.svc-scope-chip button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}
.svc-scope-chip button:hover { background: var(--bg-hover); color: var(--text-primary); }
.text-secondary { color: var(--text-secondary); }

.status-ok { color: var(--ok); }
.status-error { color: var(--error); }
.status-warning { color: var(--warning); }

.method-badge {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 2px;
  text-transform: uppercase;
  line-height: 1.4;
}

.method-badge.GET    { background: rgba(71, 184, 129, 0.12); color: var(--method-get); }
.method-badge.POST   { background: rgba(91, 141, 217, 0.12); color: var(--method-post); }
.method-badge.PUT    { background: rgba(59, 130, 246, 0.12); color: var(--method-put); }
.method-badge.DELETE  { background: rgba(229, 88, 79, 0.12); color: var(--method-delete); }
.method-badge.PATCH  { background: rgba(155, 125, 212, 0.12); color: var(--method-patch); }

.card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--sp-8);
  color: var(--text-muted);
  font-size: 13px;
  gap: var(--sp-2);
}

.empty-state-icon {
  font-size: 28px;
  opacity: 0.3;
}

.search-spinner {
  width: 28px;
  height: 28px;
  border: 2.5px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Animations ── */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(3px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes fadeSlide {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

.fade-in {
  animation: fadeIn 0.25s ease both;
}

/* ── User Menu ── */
.user-menu-wrap {
  position: relative;
}

.user-menu-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px 2px 2px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s;
}

.user-menu-btn:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--r-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  font-family: var(--font-mono);
}

.user-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 200;
  animation: fadeIn 0.15s ease both;
}

.user-dropdown-header {
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-dropdown-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.user-dropdown-role {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-family: var(--font-mono);
}

.user-dropdown-divider {
  height: 1px;
  background: var(--border-subtle);
}

.user-dropdown-item {
  display: block;
  width: 100%;
  padding: var(--sp-2) var(--sp-4);
  text-align: left;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.12s;
}

.user-dropdown-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* ── Tenant Switcher ── */
.tenant-menu-wrap {
  position: relative;
}

.tenant-menu-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s;
  height: 26px;
}

.tenant-menu-btn:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
}

.tenant-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tenant-chevron {
  color: var(--text-muted);
  transition: transform 0.15s;
  flex-shrink: 0;
}

.tenant-chevron.open {
  transform: rotate(180deg);
}

.tenant-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 180px;
  background: var(--bg-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 200;
  animation: fadeIn 0.15s ease both;
}

.tenant-dropdown-header {
  padding: var(--sp-2) var(--sp-4);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.tenant-dropdown-divider {
  height: 1px;
  background: var(--border-subtle);
}

.tenant-dropdown-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: var(--sp-2) var(--sp-4);
  text-align: left;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.12s;
}

.tenant-dropdown-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.tenant-dropdown-item.active {
  color: var(--accent);
}

.tenant-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: 0;
  flex-shrink: 0;
  transition: opacity 0.12s;
}

.tenant-dot.visible {
  opacity: 1;
}

.tenant-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Command Palette Hint (topbar) ── */
.cmd-k-hint {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all 0.15s;
  height: 26px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.02em;
}

.cmd-k-hint:hover {
  border-color: var(--border-default);
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.cmd-k-hint kbd {
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 2px;
  padding: 0px 3px;
  line-height: 1.5;
}

/* ═══ App shell ═══
   The application is intentionally quiet: navigation owns the left edge,
   the header owns global context, and page content gets a consistent canvas. */
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-root);
  background-image: none;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 74px;
  flex: 0 0 74px;
  gap: clamp(24px, 5vw, 96px);
  padding: 0 38px;
  position: sticky;
  top: 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
  box-shadow: none;
  backdrop-filter: blur(16px);
  z-index: 100;
}

.topbar::after { display: none; }

.logo {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.035em;
}

.logo-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--text-inverse);
  font-family: var(--font-ui);
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
}

.logo-text {
  font-family: var(--font-ui);
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.035em;
}

.global-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(100%, 1430px);
  height: 36px;
  min-width: 160px;
  padding: 0 14px;
  color: var(--text-secondary);
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 9px;
  text-align: left;
  transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
}

.global-search:hover,
.global-search:focus-visible {
  background: var(--bg-raised);
  border-color: var(--accent-muted);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.global-search svg {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  fill: none;
  stroke: var(--accent);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.35;
}

.global-search span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.global-search kbd {
  margin-left: auto;
  padding: 1px 5px;
  color: var(--text-muted);
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 9px;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: 0 0 auto;
}

.tenant-menu-btn,
.tenant-standalone {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  height: 30px;
  padding: 0;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  font-size: 12px;
}

.tenant-menu-btn:hover,
.tenant-standalone:hover { color: var(--text-primary); }

.tenant-status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-dim);
}

.tenant-name {
  max-width: 160px;
  color: inherit;
  font-size: 12px;
  font-weight: 500;
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease;
}

.theme-toggle:hover { color: var(--accent); background: var(--accent-soft); }
.theme-toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 1.3; }

.env-badge { padding: 3px 7px; }

.user-menu-btn {
  padding: 0;
  border: 0;
  background: transparent;
}

.user-menu-btn:hover { background: transparent; }

.user-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #e9eef6;
  color: #1b273b;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 700;
}

.user-name { display: none; }

.app-frame {
  display: flex;
  flex: 1 1 auto;
  min-height: calc(100vh - 74px);
}

.main {
  flex: 1 1 auto;
  min-width: 0;
  max-width: none;
  width: auto;
  margin: 0;
  padding: clamp(26px, 3.2vw, 58px) clamp(24px, 4vw, 72px) 72px;
}

@media (max-width: 1050px) {
  .topbar { gap: 24px; padding-inline: 24px; }
  .main { padding-inline: 32px; }
}

@media (max-width: 760px) {
  .topbar {
    height: auto;
    min-height: 64px;
    flex-wrap: wrap;
    gap: 12px;
    padding: 14px 16px;
  }
  .logo-text { font-size: 15px; }
  .global-search { order: 3; flex-basis: 100%; }
  .topbar-right { margin-left: auto; gap: 10px; }
  .app-frame { min-height: calc(100vh - 120px); }
  .main { padding: 24px 16px calc(90px + env(safe-area-inset-bottom)); }
}

@media (max-width: 480px) {
  .tenant-name, .theme-toggle, .env-badge { display: none; }
  .topbar-right { gap: 6px; }
  .global-search kbd { display: none; }
}
</style>
