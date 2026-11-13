<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useRoute } from 'vue-router'
import { navigationItemIsActive, type NavigationItem, type NavigationSubmenu } from '../navigation'

const props = withDefaults(defineProps<{
  submenu: NavigationSubmenu
  items: NavigationItem[]
  variant?: 'sidebar' | 'mobile' | 'compact'
}>(), { variant: 'sidebar' })
const route = useRoute()
const expanded = ref(false)
const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const buttonId = `navigation-submenu-${instanceId}-button`
const linksId = `navigation-submenu-${instanceId}-links`
const active = computed(() => props.items.some(isActive))
function isActive(item: NavigationItem): boolean { return navigationItemIsActive(item, typeof route.name === 'string' ? route.name : null) }
watch(() => route.name, () => { if (active.value) expanded.value = true }, { immediate: true })
</script>

<template>
  <div v-if="items.length" class="navigation-submenu" :class="`navigation-submenu--${variant}`">
    <button :id="buttonId" class="navigation-submenu-toggle" :class="{ 'contains-active': active }" type="button" :aria-expanded="expanded" :aria-controls="linksId" @click="expanded = !expanded">
      <span class="navigation-submenu-icon" aria-hidden="true">{{ submenu.icon }}</span>
      <span class="navigation-submenu-label">{{ submenu.label }}</span>
      <span class="navigation-submenu-chevron" :class="{ open: expanded }" aria-hidden="true">›</span>
    </button>
    <div v-show="expanded" :id="linksId" class="navigation-submenu-links" role="group" :aria-labelledby="buttonId">
      <router-link v-for="item in items" :key="item.id" :to="item.path" class="navigation-submenu-link" :class="{ active: isActive(item) }" :aria-current="isActive(item) ? 'page' : undefined">{{ item.label }}</router-link>
    </div>
  </div>
</template>

<style scoped>
.navigation-submenu { min-width: 0; }
.navigation-submenu-toggle { display: grid; grid-template-columns: 6px minmax(0, 1fr) 10px; align-items: center; gap: 12px; width: 100%; min-height: 40px; padding: var(--sp-2) 12px; border: 0; border-radius: 7px; color: var(--text-secondary); background: transparent; text-align: left; font: 600 12px/1.4 var(--font-ui); cursor: pointer; }
.navigation-submenu-toggle:hover, .navigation-submenu-link:hover { color: var(--text-primary); background: var(--bg-raised); }
.navigation-submenu-toggle.contains-active { color: var(--accent); }
.navigation-submenu-toggle:focus-visible, .navigation-submenu-link:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.navigation-submenu-label { overflow-wrap: anywhere; }
.navigation-submenu-icon { width: 6px; height: 6px; border-radius: 50%; background: var(--border-strong); font-size: 0; }
.contains-active .navigation-submenu-icon { background: var(--accent); }
.navigation-submenu-chevron { color: var(--text-muted); font-size: 17px; text-align: center; }
.navigation-submenu-chevron.open { transform: rotate(90deg); }
.navigation-submenu-links { display: flex; flex-direction: column; gap: var(--sp-1); margin: var(--sp-1) 0 var(--sp-2) 15px; padding-left: var(--sp-2); border-left: 1px solid var(--border-subtle); }
.navigation-submenu-link { display: flex; align-items: center; min-height: 34px; padding: var(--sp-2) 10px; border-radius: 6px; color: var(--text-secondary); font-size: 12px; font-weight: 500; text-decoration: none; overflow-wrap: anywhere; }
.navigation-submenu-link.active { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.navigation-submenu--mobile .navigation-submenu-toggle { grid-template-columns: 24px minmax(0, 1fr) 16px; gap: var(--sp-2); min-height: 44px; padding: var(--sp-2) 10px; font-size: 13px; }
.navigation-submenu--mobile .navigation-submenu-icon, .navigation-submenu--compact .navigation-submenu-icon { width: auto; height: auto; border-radius: 0; color: var(--accent); background: transparent; font-size: 16px; text-align: center; }
.navigation-submenu--mobile .navigation-submenu-link { min-height: 44px; }
.navigation-submenu--compact .navigation-submenu-toggle { grid-template-columns: 14px minmax(0, 1fr) 10px; gap: var(--sp-2); min-height: 31px; padding: var(--sp-1) 9px; font-size: 11px; }
.navigation-submenu--compact .navigation-submenu-link { min-height: 31px; font-size: 11px; }
@media (pointer: coarse) { .navigation-submenu-toggle, .navigation-submenu-link { min-height: 44px; } }
</style>
