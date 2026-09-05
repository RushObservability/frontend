<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { SettingsIntegrationNavItem, SettingsTabGroup, SettingsTabId } from '../views/settings/navigation'

const props = withDefaults(defineProps<{
  groups: SettingsTabGroup[]
  integrations: SettingsIntegrationNavItem[]
  activeTab: SettingsTabId
  activeIntegration: string
  integrationsExpanded: boolean
  showRail?: boolean
}>(), {
  showRail: true,
})

const emit = defineEmits<{
  selectTab: [id: SettingsTabId]
  selectIntegration: [key: string]
  toggleIntegrations: []
}>()

const orderedTabs = computed(() => props.groups.flatMap(group => group.items))
const mobileValue = computed(() => props.activeTab === 'integrations' && props.activeIntegration
  ? `integrations/${props.activeIntegration}`
  : props.activeTab)

function selectTab(id: SettingsTabId) {
  if (id === 'integrations') emit('toggleIntegrations')
  else emit('selectTab', id)
}

function onTabKeydown(event: KeyboardEvent) {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const current = orderedTabs.value.findIndex(tab => tab.id === props.activeTab)
  let next = current
  if (event.key === 'ArrowUp') next = (current - 1 + orderedTabs.value.length) % orderedTabs.value.length
  if (event.key === 'ArrowDown') next = (current + 1) % orderedTabs.value.length
  if (event.key === 'Home') next = 0
  if (event.key === 'End') next = orderedTabs.value.length - 1
  const target = orderedTabs.value[next]
  if (!target) return
  selectTab(target.id)
  void nextTick(() => document.getElementById(`tab-${target.id}`)?.focus())
}

function onMobileChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value.startsWith('integrations/')) {
    emit('selectIntegration', value.slice('integrations/'.length))
    return
  }
  selectTab(value as SettingsTabId)
}
</script>

<template>
  <aside v-if="showRail" class="settings-section-rail" role="tablist" aria-label="Settings sections" @keydown="onTabKeydown">
    <div class="settings-section-brand">Settings</div>
    <div v-for="group in groups" :key="group.name" class="settings-section-group">
      <div class="settings-section-group-label">{{ group.name }}</div>
      <template v-for="tab in group.items" :key="tab.id">
        <div v-if="tab.id === 'integrations'" class="settings-section-parent-row">
          <button
            :id="`tab-${tab.id}`"
            :class="['settings-section-item', 'settings-section-disclosure', { active: activeTab === tab.id }]"
            :tabindex="activeTab === tab.id ? 0 : -1"
            :aria-expanded="integrationsExpanded"
            aria-controls="settings-section-integration-links"
            @click="emit('toggleIntegrations')"
          >
            <span>{{ tab.label }}</span>
            <span :class="{ open: integrationsExpanded }" aria-hidden="true">›</span>
          </button>
        </div>
        <button
          v-else
          :id="`tab-${tab.id}`"
          :class="['settings-section-item', { active: activeTab === tab.id }]"
          :tabindex="activeTab === tab.id ? 0 : -1"
          role="tab"
          :aria-selected="activeTab === tab.id"
          :aria-controls="`panel-${tab.id}`"
          @click="emit('selectTab', tab.id)"
        >{{ tab.label }}</button>

        <div
          v-if="tab.id === 'integrations'"
          id="settings-section-integration-links"
          :class="['settings-section-subgroup', { open: integrationsExpanded }]"
        >
          <button
            v-for="(integration, index) in integrations"
            :key="integration.key"
            :class="['settings-section-subitem', { active: activeTab === 'integrations' && activeIntegration === integration.key }]"
            :style="{ '--item-index': index }"
            @click="emit('selectIntegration', integration.key)"
          >{{ integration.label }}</button>
        </div>
      </template>
    </div>
  </aside>

  <label class="settings-section-picker">
    <span>Settings section</span>
    <select :value="mobileValue" @change="onMobileChange">
      <optgroup v-for="group in groups" :key="group.name" :label="group.name">
        <option
          v-for="tab in group.items.filter(item => item.id !== 'integrations')"
          :key="tab.id"
          :value="tab.id"
        >{{ tab.label }}</option>
      </optgroup>
      <optgroup label="Integration settings">
        <option v-for="integration in integrations" :key="integration.key" :value="`integrations/${integration.key}`">
          {{ integration.label }}
        </option>
      </optgroup>
    </select>
  </label>
</template>

<style scoped>
.settings-section-rail { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 20px; padding-right: 20px; border-right: 1px solid var(--border-subtle); }
.settings-section-brand, .settings-section-group-label { padding-inline: 8px; color: var(--text-muted); font-size: 11px; font-weight: 650; letter-spacing: .08em; text-transform: uppercase; }
.settings-section-group { display: flex; flex-direction: column; gap: 2px; }
.settings-section-group-label { margin-bottom: 4px; }
.settings-section-item { display: flex; align-items: center; width: 100%; min-height: 34px; padding: 0 8px; color: var(--text-secondary); background: transparent; border: 0; border-radius: 5px; font-family: var(--font-ui); font-size: 13px; text-align: left; }
.settings-section-item:hover { color: var(--text-primary); background: var(--bg-hover); }
.settings-section-item.active { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.settings-section-item:focus-visible, .settings-section-subitem:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.settings-section-parent-row { display: block; }
.settings-section-disclosure { justify-content: space-between; }
.settings-section-disclosure > span:last-child { color: var(--text-muted); font-size: 18px; transition: color 180ms ease, transform 180ms ease; }
.settings-section-disclosure > span:last-child.open { color: var(--accent); transform: rotate(90deg); }
.settings-section-subgroup { display: flex; max-height: 0; overflow: hidden; flex-direction: column; gap: 1px; margin-left: 16px; padding-left: 8px; opacity: 0; border-left: 1px solid var(--border-subtle); transition: max-height 220ms ease, opacity 160ms ease; }
.settings-section-subgroup.open { max-height: 260px; margin-block: 2px; opacity: 1; }
.settings-section-subitem { min-height: 30px; padding: 0 8px; color: var(--text-muted); background: transparent; border: 0; border-radius: 4px; font-family: var(--font-ui); font-size: 12px; text-align: left; opacity: 0; transform: translateX(-3px); transition: color 120ms ease, background 120ms ease, opacity 180ms ease calc(var(--item-index) * 25ms), transform 180ms ease calc(var(--item-index) * 25ms); }
.settings-section-subgroup.open .settings-section-subitem { opacity: 1; transform: none; }
.settings-section-subitem:hover { color: var(--text-primary); background: var(--bg-hover); }
.settings-section-subitem.active { color: var(--accent); background: var(--accent-soft); font-weight: 600; }
.settings-section-picker { display: none; }

@media (max-width: 760px) {
  .settings-section-rail { display: none; }
  .settings-section-picker { display: grid; gap: 7px; }
  .settings-section-picker span { color: var(--text-muted); font-size: 11px; font-weight: 650; letter-spacing: .07em; text-transform: uppercase; }
  .settings-section-picker select { width: 100%; min-height: 44px; padding: 0 38px 0 12px; color: var(--text-primary); background: var(--bg-surface); border: 1px solid var(--border-default); border-radius: 8px; font: 600 14px var(--font-ui); }
  .settings-section-picker select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
}

@media (prefers-reduced-motion: reduce) {
  .settings-section-disclosure span, .settings-section-subgroup, .settings-section-subitem { transition-duration: 1ms; }
}
</style>
