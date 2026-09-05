<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { navigationItemIsActive, type NavigationGroup, type NavigationItem } from '../navigation'
import { useModalFocus } from '../composables/useModalFocus'
import { SETTINGS_INTEGRATIONS, SETTINGS_TAB_GROUPS, type SettingsTabId } from '../views/settings/navigation'

const props = defineProps<{
  groups: NavigationGroup[]
}>()

const route = useRoute()
const drawerOpen = ref(false)
const drawerRef = ref<HTMLElement | null>(null)
const appMenuOpen = ref(false)
const settingsIntegrationsOpen = ref(false)
const mobilePrimaryItems = computed(() => props.groups.flatMap(group => group.items).filter(item => item.mobilePrimary))
const settingsMode = computed(() => route.name === 'settings')
const nonSettingsGroups = computed(() => props.groups
  .map(group => ({ ...group, items: group.items.filter(item => item.id !== 'settings') }))
  .filter(group => group.items.length))

function settingsHash(): string {
  return route.hash.replace(/^#/, '') || 'general'
}

function settingsItemActive(id: SettingsTabId): boolean {
  return settingsHash().split('/')[0] === id
}

function settingsIntegrationActive(key: string): boolean {
  return settingsHash() === `integrations/${key}`
}

function settingsPath(id: SettingsTabId): { name: string; hash: string } {
  return { name: 'settings', hash: `#${id}` }
}

function isActive(item: NavigationItem): boolean {
  return navigationItemIsActive(item, typeof route.name === 'string' ? route.name : null)
}

function closeDrawer() {
  drawerOpen.value = false
}

const { handleModalKeydown } = useModalFocus(
  () => drawerOpen.value,
  drawerRef,
  closeDrawer,
)

watch(() => route.fullPath, () => {
  closeDrawer()
  if (!settingsMode.value) return
  appMenuOpen.value = false
  if (settingsHash().startsWith('integrations/')) settingsIntegrationsOpen.value = true
}, { immediate: true })
</script>

<template>
  <aside class="app-navigation" aria-label="Primary navigation">
    <nav v-if="settingsMode" class="settings-navigation-list" aria-label="Settings navigation">
      <div class="settings-navigation-head">
        <div>
          <span>Control</span>
          <strong>Settings</strong>
        </div>
        <router-link to="/" aria-label="Leave settings">×</router-link>
      </div>

      <section v-for="group in SETTINGS_TAB_GROUPS" :key="group.name" class="settings-navigation-group">
        <h2>{{ group.name }}</h2>
        <template v-for="item in group.items" :key="item.id">
          <div v-if="item.id === 'integrations'" class="settings-navigation-parent">
            <button
              type="button"
              class="settings-navigation-item settings-navigation-disclosure"
              :class="{ active: settingsItemActive(item.id) }"
              :aria-expanded="settingsIntegrationsOpen"
              aria-controls="settings-integration-links"
              @click="settingsIntegrationsOpen = !settingsIntegrationsOpen"
            >
              <span class="app-navigation-dot" aria-hidden="true"></span>
              <span>{{ item.label }}</span>
              <span class="settings-navigation-chevron" :class="{ open: settingsIntegrationsOpen }" aria-hidden="true">›</span>
            </button>
          </div>
          <router-link
            v-else
            :to="settingsPath(item.id)"
            class="settings-navigation-item"
            :class="{ active: settingsItemActive(item.id) }"
            :aria-current="settingsItemActive(item.id) ? 'page' : undefined"
          >
            <span class="app-navigation-dot" aria-hidden="true"></span>
            <span>{{ item.label }}</span>
          </router-link>

          <div
            v-if="item.id === 'integrations'"
            id="settings-integration-links"
            class="settings-integration-list"
            :class="{ open: settingsIntegrationsOpen }"
          >
            <router-link
              v-for="integration in SETTINGS_INTEGRATIONS"
              :key="integration.key"
              :to="{ name: 'settings', hash: `#integrations/${integration.key}` }"
              :class="{ active: settingsIntegrationActive(integration.key) }"
              :tabindex="settingsIntegrationsOpen ? 0 : -1"
            >{{ integration.label }}</router-link>
          </div>
        </template>
      </section>

      <div class="app-menu-disclosure">
        <button type="button" :aria-expanded="appMenuOpen" @click="appMenuOpen = !appMenuOpen">
          <span>App navigation</span>
          <span :class="{ open: appMenuOpen }" aria-hidden="true">›</span>
        </button>
        <div class="collapsed-app-menu" :class="{ open: appMenuOpen }">
          <section v-for="group in nonSettingsGroups" :key="group.id">
            <h3>{{ group.label }}</h3>
            <router-link v-for="item in group.items" :key="item.id" :to="item.path">
              <span aria-hidden="true">{{ item.icon }}</span>{{ item.label }}
            </router-link>
          </section>
        </div>
      </div>
    </nav>

    <nav v-else class="app-navigation-list">
      <section v-for="group in groups" :key="group.id" class="app-navigation-group">
        <h2 class="app-navigation-label">{{ group.label }}</h2>
        <router-link
          v-for="item in group.items"
          :key="item.id"
          :to="item.path"
          class="app-navigation-item"
          :class="{ active: isActive(item) }"
          :aria-current="isActive(item) ? 'page' : undefined"
        >
          <span class="app-navigation-dot" aria-hidden="true"></span>
          <span>{{ item.label }}</span>
        </router-link>
      </section>
    </nav>
  </aside>

  <nav class="mobile-navigation" aria-label="Primary navigation">
    <router-link
      v-for="item in mobilePrimaryItems"
      :key="item.id"
      :to="item.path"
      class="mobile-navigation-item"
      :class="{ active: isActive(item) }"
      :aria-current="isActive(item) ? 'page' : undefined"
    >
      <span class="mobile-navigation-icon" aria-hidden="true">{{ item.icon }}</span>
      <span>{{ item.label }}</span>
    </router-link>
    <button
      type="button"
      class="mobile-navigation-item"
      :class="{ active: drawerOpen }"
      aria-haspopup="dialog"
      :aria-expanded="drawerOpen"
      @click="drawerOpen = true"
    >
      <span class="mobile-navigation-icon" aria-hidden="true">•••</span>
      <span>More</span>
    </button>
  </nav>

  <Teleport to="body">
    <Transition name="mobile-menu">
      <div v-if="drawerOpen" class="mobile-menu-overlay" @click.self="closeDrawer">
        <section
          ref="drawerRef"
          class="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-menu-title"
          tabindex="-1"
          @keydown="handleModalKeydown"
        >
          <header class="mobile-menu-header">
            <div>
              <p class="mobile-menu-eyebrow">Rush Observability</p>
              <h2 id="mobile-menu-title">Navigate</h2>
            </div>
            <button type="button" class="mobile-menu-close" aria-label="Close navigation" @click="closeDrawer">×</button>
          </header>
          <div class="mobile-menu-groups">
            <section v-for="group in groups" :key="group.id" class="mobile-menu-group">
              <h3>{{ group.label }}</h3>
              <router-link
                v-for="item in group.items"
                :key="item.id"
                :to="item.path"
                class="mobile-menu-item"
                :class="{ active: isActive(item) }"
                :aria-current="isActive(item) ? 'page' : undefined"
              >
                <span class="mobile-menu-icon" aria-hidden="true">{{ item.icon }}</span>
                <span>{{ item.label }}</span>
                <span class="mobile-menu-arrow" aria-hidden="true">→</span>
              </router-link>
            </section>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-navigation {
  position: sticky;
  top: 74px;
  display: flex;
  flex: 0 0 228px;
  flex-direction: column;
  align-self: flex-start;
  width: 228px;
  height: calc(100vh - 74px);
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}

.app-navigation-list {
  display: flex;
  flex-direction: column;
  gap: 27px;
  padding: 29px 16px 24px;
  overflow-y: auto;
}

.settings-navigation-list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 22px;
  padding: 22px 14px 24px;
  overflow-y: auto;
}

.settings-navigation-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 9px 4px;
}
.settings-navigation-head div { display: grid; gap: 2px; }
.settings-navigation-head span {
  color: var(--accent);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: .11em;
  text-transform: uppercase;
}
.settings-navigation-head strong { color: var(--text-primary); font-size: 17px; font-weight: 650; letter-spacing: -.02em; }
.settings-navigation-head > a {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--text-muted);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  font-size: 18px;
  line-height: 1;
}
.settings-navigation-head > a:hover { color: var(--text-primary); background: var(--bg-raised); border-color: var(--border-default); }

.settings-navigation-group { display: flex; flex-direction: column; gap: 3px; }
.settings-navigation-group > h2 {
  margin: 0;
  padding: 0 10px 6px;
  color: var(--text-muted);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .09em;
  text-transform: uppercase;
}
.settings-navigation-item {
  display: grid;
  grid-template-columns: 6px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  text-align: left;
  transition: color 130ms ease, background 130ms ease;
}
.settings-navigation-item:hover { color: var(--text-primary); background: var(--bg-raised); }
.settings-navigation-item.active { color: var(--accent); background: var(--accent-soft); }
.settings-navigation-item.active .app-navigation-dot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.settings-navigation-item:focus-visible,
.settings-navigation-parent button:focus-visible,
.settings-integration-list a:focus-visible,
.app-menu-disclosure > button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }

.settings-navigation-parent { display: block; }
.settings-navigation-disclosure { grid-template-columns: 6px minmax(0, 1fr) 16px; }
.settings-navigation-chevron {
  color: var(--text-muted);
  font-size: 17px;
  text-align: center;
  transition: color 160ms ease, transform 160ms ease;
}
.settings-navigation-chevron.open { color: var(--accent); transform: rotate(90deg); }
.settings-integration-list {
  display: grid;
  grid-template-rows: 0fr;
  margin-left: 18px;
  padding-left: 8px;
  border-left: 1px solid var(--border-subtle);
  opacity: 0;
  transition: grid-template-rows 180ms ease, opacity 140ms ease;
}
.settings-integration-list::before { min-height: 0; content: ''; }
.settings-integration-list.open { grid-template-rows: 1fr; padding-block: 3px; opacity: 1; }
.settings-integration-list a {
  min-height: 30px;
  padding: 7px 8px;
  overflow: hidden;
  color: var(--text-muted);
  border-radius: 5px;
  font-size: 11px;
  line-height: 16px;
}
.settings-integration-list:not(.open) a { display: none; }
.settings-integration-list a:hover { color: var(--text-primary); background: var(--bg-raised); }
.settings-integration-list a.active { color: var(--accent); background: var(--accent-soft); font-weight: 650; }

.app-menu-disclosure { margin-top: auto; padding-top: 4px; border-top: 1px solid var(--border-subtle); }
.app-menu-disclosure > button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 36px;
  padding: 0 9px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 6px;
  font: 650 11px var(--font-ui);
}
.app-menu-disclosure > button:hover { color: var(--text-primary); background: var(--bg-raised); }
.app-menu-disclosure > button span:last-child { font-size: 16px; transition: transform 160ms ease; }
.app-menu-disclosure > button span:last-child.open { transform: rotate(90deg); }
.collapsed-app-menu { display: none; padding: 6px 0 0; }
.collapsed-app-menu.open { display: grid; gap: 12px; }
.collapsed-app-menu section { display: grid; gap: 2px; }
.collapsed-app-menu h3 { margin: 0; padding: 0 9px 3px; color: var(--text-muted); font-size: 9px; letter-spacing: .08em; text-transform: uppercase; }
.collapsed-app-menu a { display: flex; align-items: center; gap: 8px; min-height: 31px; padding: 0 9px; color: var(--text-secondary); border-radius: 5px; font-size: 11px; font-weight: 600; }
.collapsed-app-menu a:hover { color: var(--text-primary); background: var(--bg-raised); }
.collapsed-app-menu a span { width: 14px; color: var(--text-muted); text-align: center; }

.app-navigation-group { display: flex; flex-direction: column; gap: 5px; }
.app-navigation-label {
  margin: 0;
  padding: 0 12px 8px;
  color: var(--text-muted);
  font: 600 var(--text-xs, 11px)/1.2 var(--font-ui);
  letter-spacing: .08em;
  text-transform: uppercase;
}

.app-navigation-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 0 12px;
  color: var(--text-secondary);
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  transition: color 140ms ease, background 140ms ease, transform 140ms ease;
}
.app-navigation-item:hover { color: var(--text-primary); background: var(--bg-raised); transform: translateX(1px); }
.app-navigation-item.active { color: var(--accent); background: var(--accent-soft); }
.app-navigation-item:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.app-navigation-dot { width: 6px; height: 6px; flex: 0 0 auto; border-radius: 50%; background: var(--border-strong); }
.app-navigation-item.active .app-navigation-dot { background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }

.mobile-navigation { display: none; }

.mobile-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 8990;
  display: none;
  align-items: flex-end;
  background: color-mix(in srgb, var(--bg-void) 72%, transparent);
  backdrop-filter: blur(4px);
}
.mobile-menu {
  width: 100%;
  max-height: min(82vh, 720px);
  overflow: auto;
  color: var(--text-primary);
  background: var(--bg-surface);
  border-top: 1px solid var(--border-strong);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -24px 70px rgba(0, 0, 0, .28);
  outline: none;
}
.mobile-menu-header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 14px; background: color-mix(in srgb, var(--bg-surface) 94%, transparent); border-bottom: 1px solid var(--border-subtle); backdrop-filter: blur(14px); }
.mobile-menu-header h2 { margin: 2px 0 0; font-size: 19px; letter-spacing: -.02em; }
.mobile-menu-eyebrow { margin: 0; color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.mobile-menu-close { width: 40px; height: 40px; padding: 0; color: var(--text-secondary); background: var(--bg-raised); border: 1px solid var(--border-default); border-radius: 10px; font-size: 24px; line-height: 1; }
.mobile-menu-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px 16px; padding: 20px 20px max(28px, env(safe-area-inset-bottom)); }
.mobile-menu-group { min-width: 0; }
.mobile-menu-group h3 { margin: 0 0 7px; color: var(--text-muted); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
.mobile-menu-item { display: grid; grid-template-columns: 24px minmax(0, 1fr) 16px; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px; color: var(--text-secondary); border-radius: 8px; font-size: 13px; font-weight: 600; }
.mobile-menu-item:hover { color: var(--text-primary); background: var(--bg-raised); }
.mobile-menu-item.active { color: var(--accent); background: var(--accent-soft); }
.mobile-menu-icon { color: var(--accent); text-align: center; }
.mobile-menu-arrow { color: var(--text-muted); }

.mobile-menu-enter-active, .mobile-menu-leave-active { transition: opacity 180ms ease; }
.mobile-menu-enter-active .mobile-menu, .mobile-menu-leave-active .mobile-menu { transition: transform 220ms cubic-bezier(.16, 1, .3, 1); }
.mobile-menu-enter-from, .mobile-menu-leave-to { opacity: 0; }
.mobile-menu-enter-from .mobile-menu, .mobile-menu-leave-to .mobile-menu { transform: translateY(100%); }

@media (max-width: 1050px) {
  .app-navigation { flex-basis: 200px; width: 200px; }
}

@media (max-width: 760px) {
  .app-navigation { display: none; }
  .mobile-navigation {
    position: fixed;
    inset: auto 0 0;
    z-index: 90;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    min-height: calc(64px + env(safe-area-inset-bottom));
    padding: 6px 6px env(safe-area-inset-bottom);
    background: color-mix(in srgb, var(--bg-surface) 96%, transparent);
    border-top: 1px solid var(--border-subtle);
    box-shadow: 0 -8px 30px rgba(0, 0, 0, .08);
    backdrop-filter: blur(16px);
  }
  .mobile-navigation-item { display: flex; min-width: 0; min-height: 50px; align-items: center; justify-content: center; flex-direction: column; gap: 3px; padding: 3px; color: var(--text-muted); background: transparent; border: 0; border-radius: 8px; font-size: 10px; font-weight: 650; }
  .mobile-navigation-item.active { color: var(--accent); background: var(--accent-soft); }
  .mobile-navigation-item:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
  .mobile-navigation-icon { height: 20px; font-size: 17px; line-height: 20px; }
  .mobile-menu-overlay { display: flex; }
}

@media (max-width: 430px) {
  .mobile-menu-groups { grid-template-columns: 1fr; }
}

@media (prefers-reduced-motion: reduce) {
  .app-navigation-item, .mobile-menu-enter-active, .mobile-menu-leave-active,
  .mobile-menu-enter-active .mobile-menu, .mobile-menu-leave-active .mobile-menu { transition-duration: 1ms; }
}
</style>
