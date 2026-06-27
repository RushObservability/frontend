<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useAuth } from './composables/useAuth'
import { useTenant } from './composables/useTenant'
import { useFeatures } from './composables/useFeatures'
import { useLicense } from './composables/useLicense'
import { availableAddons } from './integrations/catalog'
import { isAddonEnabled } from './composables/useIntegrationEnabled'
import CommandPalette from './components/CommandPalette.vue'
import { defaultTheme } from './config'

const route = useRoute()
const router = useRouter()
const { user, isAuthenticated, isAdmin, checked, checkSession, logout } = useAuth()
const { tenants, activeTenantName, showSwitcher, loadTenants, setTenant, activeTenant } = useTenant()
const currentNav = computed(() => route.name as string)
const isLoginPage = computed(() => route.name === 'login')

// A saved preference always wins; otherwise fall back to the deploy default
// (DEFAULT_THEME env var, defaults to light when unset).
const _storedTheme = localStorage.getItem('rush-theme')
const theme = ref<'dark' | 'light'>(
  _storedTheme === 'dark' || _storedTheme === 'light' ? _storedTheme : defaultTheme()
)
const appEnv = import.meta.env.MODE

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

const { features, loadFeatures } = useFeatures()
const { loadLicense, hasEntitlement } = useLicense()
const featureOn = (k: string) => !!(features.value as Record<string, boolean | undefined>)[k]
const hasIntegrations = computed(() => availableAddons(hasEntitlement, featureOn, isAddonEnabled).length > 0)

const userMenuOpen = ref(false)
const tenantMenuOpen = ref(false)
const paletteOpen = ref(false)

function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  }
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
onMounted(() => {
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onGlobalKeydown)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick)
  document.removeEventListener('keydown', onGlobalKeydown)
})

async function handleLogout() {
  userMenuOpen.value = false
  await logout()
  router.push({ name: 'login' })
}

watch(theme, (t) => {
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('rush-theme', t)
}, { immediate: true })

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
watch(isAuthenticated, (authed) => {
  if (authed) loadTenants()
}, { immediate: true })
</script>

<template>
  <div class="app">
    <header v-if="!isLoginPage" class="topbar">
      <div class="topbar-left">
        <router-link to="/" class="logo">
          <img src="/logo-mark.svg" alt="Rush" class="logo-icon" />
          <span class="logo-text">Rush</span>
        </router-link>
        <nav class="nav">
          <router-link
            to="/"
            class="nav-item"
            :class="{ active: currentNav === 'explore' }"
          >
            Explore
          </router-link>
          <router-link
            to="/services"
            class="nav-item"
            :class="{ active: currentNav === 'services' }"
          >
            Services
          </router-link>
          <router-link
            to="/metrics"
            class="nav-item"
            :class="{ active: currentNav === 'metrics' }"
          >
            Metrics
          </router-link>
          <router-link
            v-if="features.rum !== false"
            to="/rum"
            class="nav-item"
            :class="{ active: currentNav === 'rum' }"
          >
            RUM
          </router-link>
          <router-link
            to="/dashboards"
            class="nav-item"
            :class="{ active: currentNav === 'dashboards' || currentNav === 'dashboard' }"
          >
            Dashboards
          </router-link>
          <router-link
            v-if="hasIntegrations"
            to="/integrations"
            class="nav-item"
            :class="{ active: typeof currentNav === 'string' && currentNav.startsWith('integration') }"
          >
            Integrations
          </router-link>
          <router-link
            to="/alerts"
            class="nav-item"
            :class="{ active: ['alerts', 'monitor-create', 'monitor-detail', 'monitor-edit', 'alert-rule-add', 'alert-rule-edit', 'alert-channel-add'].includes(currentNav) }"
          >
            Monitors
          </router-link>
          <router-link
            to="/anomaly"
            class="nav-item"
            :class="{ active: currentNav === 'anomaly' }"
          >
            Anomaly
          </router-link>
          <router-link
            to="/slos"
            class="nav-item"
            :class="{ active: currentNav === 'slos' }"
          >
            SLOs
          </router-link>
          <router-link
            to="/deploys"
            class="nav-item"
            :class="{ active: currentNav === 'deploys' }"
          >
            Deploys
          </router-link>

          <router-link
            v-if="features.sre_agent"
            to="/sre-agent"
            class="nav-item"
            :class="{ active: currentNav === 'sre-agent' }"
          >
            SRE Agent
          </router-link>
          <router-link
            v-if="isAdmin"
            to="/audit"
            class="nav-item"
            :class="{ active: currentNav === 'audit' }"
          >
            Audit
          </router-link>
          <router-link
            v-if="isAdmin"
            to="/settings"
            class="nav-item"
            :class="{ active: currentNav === 'settings' }"
          >
            Settings
          </router-link>
        </nav>
      </div>
      <div class="topbar-right">
        <div v-if="isAuthenticated && showSwitcher" class="tenant-menu-wrap">
          <button class="tenant-menu-btn" @click="toggleTenantMenu" title="Switch tenant">
            <span class="tenant-name">{{ activeTenantName }}</span>
            <svg class="tenant-chevron" :class="{ open: tenantMenuOpen }" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div v-if="tenantMenuOpen" class="tenant-dropdown">
            <div class="tenant-dropdown-header">Tenants</div>
            <div class="tenant-dropdown-divider"></div>
            <button
              v-for="t in tenants"
              :key="t.name"
              class="tenant-dropdown-item"
              :class="{ active: t.name === activeTenant }"
              @click="selectTenant(t.name)"
            >
              <span class="tenant-dot" :class="{ visible: t.name === activeTenant }"></span>
              <span class="tenant-item-name">{{ t.name }}</span>
            </button>
          </div>
        </div>
        <button class="theme-toggle" @click="toggleTheme" :title="theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
          <span v-if="theme === 'dark'">&#9788;</span>
          <span v-else>&#9790;</span>
        </button>
        <div v-if="appEnv !== 'production'" class="env-badge">{{ appEnv }}</div>
        <div v-if="isAuthenticated" class="user-menu-wrap">
          <button class="user-menu-btn" @click="toggleUserMenu">
            <span class="user-avatar">{{ user?.display_name?.charAt(0)?.toUpperCase() || user?.username?.charAt(0)?.toUpperCase() || '?' }}</span>
            <span class="user-name">{{ user?.display_name || user?.username }}</span>
          </button>
          <div v-if="userMenuOpen" class="user-dropdown">
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
    <main class="main" v-if="!isLoginPage">
      <router-view />
    </main>
    <router-view v-else />
    <CommandPalette v-model:open="paletteOpen" />
  </div>
</template>

<style>
/* ═══════════════════════════════════════════════════════════
   Rush O11y — Design System
   "Dark Observatory" — precision instruments for production
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

  /* ── Text (WCAG AA compliant) ── */
  --text-primary:   #dfe3ec;
  --text-secondary: #8b94aa;
  --text-muted:     #6b7490;
  --text-inverse:   #060710;

  /* ── Accent: blue (token names kept; brighter on dark for legibility) ── */
  --amber:       #3b82f6;
  --amber-dim:   rgba(59, 130, 246, 0.12);
  --amber-glow:  rgba(59, 130, 246, 0.22);
  --amber-hover: #60a5fa;
  --amber-muted: rgba(59, 130, 246, 0.5);

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

  /* ── Text (WCAG AA compliant) ── */
  --text-primary:   #1a1d26;
  --text-secondary: #474e63;
  --text-muted:     #636c80;
  --text-inverse:   #ffffff;

  /* ── Accent: blue (slightly deeper brand blue for light bg contrast) ── */
  --amber:       #2563eb;
  --amber-dim:   rgba(37, 99, 235, 0.10);
  --amber-glow:  rgba(37, 99, 235, 0.16);
  --amber-hover: #1d4ed8;
  --amber-muted: rgba(37, 99, 235, 0.5);

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
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-ui);
  background: var(--bg-root);
  color: var(--text-primary);
  line-height: 1.5;
  overflow-x: hidden;
}

a {
  color: var(--amber);
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

/* ── Scrollbar ── */
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

/* ═══ App Shell ═══ */
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  /* Dot-grid texture */
  background-image: radial-gradient(circle, rgba(59, 130, 246, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* ── Topbar ── */
.topbar {
  height: 42px;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--sp-5);
  position: sticky;
  top: 0;
  z-index: 100;
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-subtle);
}

/* Subtle amber gradient line */
.topbar::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--amber-glow) 30%, var(--amber) 50%, var(--amber-glow) 70%, transparent 100%);
  opacity: 0.4;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--sp-6);
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.logo {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 14px;
  letter-spacing: -0.03em;
}

.logo-icon {
  height: 18px;
  width: auto;
}

.logo-mark {
  color: var(--amber);
  font-size: 10px;
}

.logo-text {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 14px;
}

.nav {
  display: flex;
  gap: 1px;
}

.nav-item {
  padding: 4px 12px;
  border-radius: var(--r-sm);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.01em;
  transition: color 0.15s, background 0.15s;
  position: relative;
}

.nav-item:hover {
  color: var(--text-primary);
}

.nav-item.active {
  color: var(--amber);
}

.nav-item.active::after {
  content: '';
  position: absolute;
  bottom: -12px;
  left: 12px;
  right: 12px;
  height: 1px;
  background: var(--amber);
}


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
  color: var(--amber);
  border-color: var(--border-default);
  background: var(--bg-hover);
}

/* ── Main ── */
.main {
  flex: 1;
  padding: var(--sp-6);
  max-width: 1800px;
  width: 100%;
  margin: 0 auto;
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
  background: var(--amber-dim);
  border: 1px solid color-mix(in srgb, var(--amber) 30%, transparent);
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
  border-top-color: var(--amber);
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
  background: var(--amber-dim);
  color: var(--amber);
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
  color: var(--amber);
}

.tenant-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--amber);
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
</style>
