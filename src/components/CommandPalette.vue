<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, useId } from 'vue'
import { useRouter } from 'vue-router'
import { useTenant } from '../composables/useTenant'
import { useTimeRangePreference } from '../composables/useTimeRangePreference'
import { useAuth } from '../composables/useAuth'
import { useModalFocus } from '../composables/useModalFocus'
import { SETTINGS_TABS } from '../views/settings/navigation'
import type { NavigationGroup } from '../navigation'

const props = defineProps<{
  open: boolean
  navigationGroups: NavigationGroup[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

const router = useRouter()
const { tenants, activeTenant, setTenant } = useTenant()
const { isAdmin } = useAuth()
const timeRangeMinutes = useTimeRangePreference()

const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '')
const titleId = `command-palette-${instanceId}-title`
const listboxId = `command-palette-${instanceId}-results`

// ── Action registry ──

interface PaletteAction {
  id: string
  title: string
  category: string
  icon?: string
  hint?: string
  action: () => void
}

const actions = computed<PaletteAction[]>(() => {
  const items: PaletteAction[] = []

  // Navigation uses the same visibility and route registry as the app shell.
  for (const group of props.navigationGroups) {
    for (const nav of group.items) {
    items.push({
      id: `nav-${nav.path}`,
      title: nav.label,
      category: 'Navigation',
      icon: nav.icon,
      action: () => { router.push(nav.path); close() },
    })
    }
  }

  // Explore mode shortcuts
  const exploreModes: { title: string; query: Record<string, string> }[] = [
    { title: 'Switch to APM mode',    query: {} },
    { title: 'Switch to Logs mode',   query: { mode: 'logs' } },
    { title: 'Switch to Traces mode', query: { mode: 'traces' } },
  ]

  for (const m of exploreModes) {
    items.push({
      id: `explore-${m.title}`,
      title: m.title,
      category: 'Explore',
      icon: '\u2B9E',
      action: () => { router.push({ path: '/', query: m.query }); close() },
    })
  }

  // Tenant switching
  for (const t of tenants.value) {
    if (t.name === activeTenant.value) continue
    items.push({
      id: `tenant-${t.name}`,
      title: `Switch to ${t.name}`,
      category: 'Tenant',
      icon: '\u25C6',
      action: () => { setTenant(t.name); close() },
    })
  }

  // Settings tabs
  if (isAdmin.value) {
    for (const tab of SETTINGS_TABS) {
      items.push({
        id: `settings-${tab.id}`,
        title: tab.label,
        category: 'Settings',
        icon: '\u2699',
        action: () => { router.push(`/settings#${tab.id}`); close() },
      })
    }
  }

  // Time range presets
  const timeRanges: { label: string; minutes: number }[] = [
    { label: 'Last 1h',  minutes: 60 },
    { label: 'Last 6h',  minutes: 360 },
    { label: 'Last 24h', minutes: 1440 },
    { label: 'Last 7d',  minutes: 10080 },
    { label: 'Last 30d', minutes: 43200 },
  ]

  for (const tr of timeRanges) {
    items.push({
      id: `time-${tr.minutes}`,
      title: tr.label,
      category: 'Time Range',
      icon: '\u25F7',
      action: () => {
        timeRangeMinutes.value = tr.minutes
        // Keep shareable pages in sync with the global preference.
        const currentQuery = { ...router.currentRoute.value.query }
        currentQuery.t = String(tr.minutes)
        router.replace({ query: currentQuery })
        close()
      },
    })
  }

  // Quick actions
  const visibleNavigationIds = new Set(
    props.navigationGroups.flatMap(group => group.items.map(item => item.id)),
  )
  const quickActions: { title: string; path: string; icon: string; navigationId: string }[] = [
    { title: 'New Dashboard',      path: '/dashboards',       icon: '+', navigationId: 'dashboards' },
    { title: 'New Alert Rule',     path: '/alerts/new',       icon: '+', navigationId: 'alerts' },
    { title: 'New Investigation',  path: '/investigate',      icon: '+', navigationId: 'sre-agent' },
  ]

  for (const qa of quickActions.filter(action => visibleNavigationIds.has(action.navigationId))) {
    items.push({
      id: `action-${qa.title}`,
      title: qa.title,
      category: 'Actions',
      icon: qa.icon,
      action: () => { router.push(qa.path); close() },
    })
  }

  return items
})

// ── Fuzzy matching ──

function fuzzyMatch(text: string, search: string): boolean {
  if (!search) return true
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const haystack = text.toLowerCase()
  return words.every(word => haystack.includes(word))
}

const filtered = computed(() => {
  if (!query.value.trim()) return actions.value
  return actions.value.filter(item =>
    fuzzyMatch(`${item.title} ${item.category}`, query.value)
  )
})

// Group by category
const grouped = computed(() => {
  const groups: { category: string; items: PaletteAction[] }[] = []
  const seen = new Map<string, PaletteAction[]>()

  for (const item of filtered.value) {
    if (!seen.has(item.category)) {
      const arr: PaletteAction[] = []
      seen.set(item.category, arr)
      groups.push({ category: item.category, items: arr })
    }
    seen.get(item.category)!.push(item)
  }

  return groups
})

// Flat list of filtered items for index tracking
const flatFiltered = computed(() => filtered.value)
const activeOptionId = computed(() => {
  const item = flatFiltered.value[selectedIndex.value]
  return item ? `command-option-${instanceId}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}` : undefined
})

// ── Keyboard navigation ──

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, flatFiltered.value.length - 1)
    scrollToSelected()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
    scrollToSelected()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const item = flatFiltered.value[selectedIndex.value]
    if (item) item.action()
  }
}

function scrollToSelected() {
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-index="${selectedIndex.value}"]`)
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  })
}

function close() {
  emit('update:open', false)
}

const { handleModalKeydown } = useModalFocus(
  () => props.open,
  dialogRef,
  close,
  inputRef,
)

function onDialogKeydown(event: KeyboardEvent) {
  onKeydown(event)
  handleModalKeydown(event)
}

function onOverlayClick(e: MouseEvent) {
  if ((e.target as HTMLElement).classList.contains('cmd-palette-overlay')) {
    close()
  }
}

function selectItem(index: number) {
  const item = flatFiltered.value[index]
  if (item) item.action()
}

// Reset state when opened. Focus and return-focus are handled consistently by
// useModalFocus, which is shared with drawers and mobile navigation.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    query.value = ''
    selectedIndex.value = 0
  }
})

// Reset selected index when query changes
watch(query, () => {
  selectedIndex.value = 0
})

// Compute the flat index for a given item across all groups
function flatIndex(action: PaletteAction): number {
  return flatFiltered.value.indexOf(action)
}

// Detect platform for shortcut hint
const isMac = ref(false)
onMounted(() => {
  isMac.value = navigator.platform.toUpperCase().indexOf('MAC') >= 0
})
</script>

<template>
  <Teleport to="body">
    <Transition name="cmd-palette">
      <div
        v-if="open"
        class="cmd-palette-overlay"
        @click="onOverlayClick"
        @keydown="onDialogKeydown"
      >
        <div ref="dialogRef" class="cmd-palette" role="dialog" :aria-labelledby="titleId" aria-modal="true" tabindex="-1">
          <h2 :id="titleId" class="sr-only">Command palette</h2>
          <!-- Search input -->
          <div class="cmd-palette-input-wrap">
            <svg class="cmd-palette-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="7" cy="7" r="5.25" stroke="currentColor" stroke-width="1.5"/>
              <path d="M11 11L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input
              ref="inputRef"
              v-model="query"
              type="text"
              class="cmd-palette-input"
              role="combobox"
              aria-label="Search commands"
              aria-autocomplete="list"
              aria-expanded="true"
              :aria-controls="listboxId"
              :aria-activedescendant="activeOptionId"
              placeholder="Type a command or search..."
              autocomplete="off"
              spellcheck="false"
            />
            <kbd class="cmd-palette-esc">ESC</kbd>
          </div>

          <!-- Results -->
          <div :id="listboxId" ref="listRef" class="cmd-palette-results" role="listbox" aria-label="Commands">
            <template v-if="flatFiltered.length > 0">
              <template v-for="group in grouped" :key="group.category">
                <div class="cmd-palette-category" role="presentation">{{ group.category }}</div>
                <div
                  v-for="item in group.items"
                  :key="item.id"
                  :id="`command-option-${instanceId}-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`"
                  :data-index="flatIndex(item)"
                  class="cmd-palette-item"
                  :class="{ selected: flatIndex(item) === selectedIndex }"
                  role="option"
                  :aria-selected="flatIndex(item) === selectedIndex"
                  @click="selectItem(flatIndex(item))"
                  @mouseenter="selectedIndex = flatIndex(item)"
                >
                  <span class="cmd-palette-item-icon">{{ item.icon }}</span>
                  <span class="cmd-palette-item-title">{{ item.title }}</span>
                  <span class="cmd-palette-item-cat">{{ item.category }}</span>
                </div>
              </template>
            </template>
            <div v-else class="cmd-palette-empty" role="status">
              No commands match “{{ query }}”.
            </div>
          </div>

          <!-- Footer -->
          <div class="cmd-palette-footer">
            <span class="cmd-palette-footer-hint">
              <kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate
            </span>
            <span class="cmd-palette-footer-hint">
              <kbd>&crarr;</kbd> select
            </span>
            <span class="cmd-palette-footer-hint">
              <kbd>esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../styles/components/CommandPalette.css"></style>
