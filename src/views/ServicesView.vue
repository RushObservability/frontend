<script setup lang="ts">
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useApi } from '../composables/useApi'
import { useAuth } from '../composables/useAuth'
import { useTenant } from '../composables/useTenant'
import type { ServiceEntry, GraphNode, GraphEdge, Funnel, FunnelResult, FunnelStep } from '../types'
import TimePicker from '../components/TimePicker.vue'
import DataTable, { type DataTableColumn } from '../components/DataTable.vue'

const router = useRouter()
const route  = useRoute()
const api = useApi()
const { canWrite } = useAuth()
// The Services page is built entirely from APM (trace/span) data, so it can't
// function when APM is disabled for the active tenant. Load the tenant list (if
// needed) so we know whether to show the "needs APM" notice instead.
const { apmEnabled, loadTenants: loadTenantSignals, loaded: tenantsLoaded } = useTenant()
if (!tenantsLoaded.value) loadTenantSignals()
const serviceNames = ref<string[]>([])
const services = ref<ServiceEntry[]>([])
const searchFilter = ref('')
const viewMode = ref<'catalog' | 'graph' | 'funnels'>(
  (route.query.view as string) === 'funnels' ? 'funnels'
  : (route.query.view as string) === 'graph'   ? 'graph'
  : 'catalog'
)

// Graph state
const graphNodes = ref<GraphNode[]>([])
const graphEdges = ref<GraphEdge[]>([])
const graphMinutes = ref(60)
const graphLoading = ref(false)
let graphInterval: ReturnType<typeof setInterval> | null = null

// Catalog state
const catalogLoading = ref(false)
const catalogMinutes = ref(60)
const namesLoaded = ref(false)

function onFvKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && showFunnelForm.value) { showFunnelForm.value = false }
}

onMounted(async () => {
  window.addEventListener('keydown', onFvKey)
  // Fast call — just distinct service names, renders table immediately
  try {
    const names = await api.suggestValues('service_name')
    serviceNames.value = names.filter(Boolean).sort()
    namesLoaded.value = true
  } catch {
    // fallback to full service list
    try {
      const result = await api.getServices()
      services.value = result.services
      namesLoaded.value = true
    } catch { /* ignore */ }
  }
  // Heavy call — stats load in background
  loadCatalogMetrics()
  if (viewMode.value === 'funnels') loadFunnels()
})

async function loadCatalogMetrics() {
  catalogLoading.value = true
  try {
    const result = await api.serviceGraph(catalogMinutes.value)
    graphNodes.value = result.nodes
    graphEdges.value = result.edges
  } catch {
    // fallback
  } finally {
    catalogLoading.value = false
  }
}

// Whether we've loaded stats at least once
const statsLoaded = computed(() => graphNodes.value.length > 0)

// Catalog table rows — renders service names immediately, stats fill in when ready
interface CatalogRow extends Record<string, unknown> {
  service_name: string
  request_count: number
  error_count: number
  error_rate: number
  avg_duration_ms: number
  p50_ms: number
  p95_ms: number
  p99_ms: number
  health: string
}
const catalogRows = computed<CatalogRow[]>(() => {
  const nodeMap = new Map<string, GraphNode>()
  for (const n of graphNodes.value) nodeMap.set(n.service_name, n)

  const nameSet = new Set<string>()
  for (const name of serviceNames.value) nameSet.add(name)
  for (const s of services.value) nameSet.add(s.service_name)
  for (const n of graphNodes.value) nameSet.add(n.service_name)

  const names = [...nameSet].sort()
  const filtered = names.filter(
    (name) =>
      !searchFilter.value ||
      name.toLowerCase().includes(searchFilter.value.toLowerCase())
  )

  return filtered.map((name) => {
    const node = nodeMap.get(name)
    const errorRate = node && node.request_count > 0 ? node.error_count / node.request_count : 0
    return {
      service_name: name,
      request_count: node?.request_count ?? 0,
      error_count: node?.error_count ?? 0,
      error_rate: errorRate,
      avg_duration_ms: node?.avg_duration_ms ?? 0,
      p50_ms: node?.p50_ms ?? 0,
      p95_ms: node?.p95_ms ?? 0,
      p99_ms: node?.p99_ms ?? 0,
      health: errorRate > 0.1 ? 'unhealthy' : errorRate > 0.01 ? 'degraded' : 'healthy',
    }
  })
})

// ── Catalog table sorting ──
type CatSortKey = 'service_name' | 'request_count' | 'error_count' | 'error_rate' | 'p50_ms' | 'p95_ms' | 'p99_ms'
const catSortKey = ref<CatSortKey>('request_count')
const catSortDir = ref<'asc' | 'desc'>('desc')
const catalogColumns: DataTableColumn[] = [
  { key: 'service_name', label: 'Service Name', sortable: true, headerClass: 'col-name', cellClass: 'col-name' },
  { key: 'health', label: 'Health', cellClass: 'col-health' },
  { key: 'request_count', label: 'Requests', align: 'right', sortable: true, cellClass: 'col-num' },
  { key: 'error_count', label: 'Errors', align: 'right', sortable: true, cellClass: 'col-num' },
  { key: 'error_rate', label: 'Error %', align: 'right', sortable: true, cellClass: 'col-num' },
  { key: 'p50_ms', label: 'P50', align: 'right', sortable: true, cellClass: 'col-num' },
  { key: 'p95_ms', label: 'P95', align: 'right', sortable: true, cellClass: 'col-num' },
  { key: 'p99_ms', label: 'P99', align: 'right', sortable: true, cellClass: 'col-num' },
]
const sortedCatalogRows = computed(() => {
  const rows = [...catalogRows.value]
  const k = catSortKey.value
  const dir = catSortDir.value === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    const av = a[k]
    const bv = b[k]
    if (typeof av === 'string') return dir * av.localeCompare(bv as string)
    return dir * ((av as number) - (bv as number))
  })
  return rows
})
function setCatSort(k: CatSortKey) {
  if (catSortKey.value === k) {
    catSortDir.value = catSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    catSortKey.value = k
    catSortDir.value = k === 'service_name' ? 'asc' : 'desc'
  }
}
function onCatalogSort(key: string) {
  if (key === 'service_name' || key === 'request_count' || key === 'error_count' || key === 'error_rate' || key === 'p50_ms' || key === 'p95_ms' || key === 'p99_ms') {
    setCatSort(key)
  }
}
function openService(row: Record<string, unknown>) {
  const name = String(row.service_name ?? '')
  if (name) router.push({ path: `/services/${encodeURIComponent(name)}`, query: { t: String(catalogMinutes.value) } })
}

function rowNumber(value: unknown): number {
  return typeof value === 'number' && isFinite(value) ? value : Number(value) || 0
}

function rowHealth(value: unknown): string {
  return typeof value === 'string' ? value : 'healthy'
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 1) return `${ms.toFixed(1)}ms`
  if (ms > 0) return `${(ms * 1000).toFixed(0)}us`
  return '-'
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function latencyClass(ms: number): string {
  if (ms >= 1000) return 'lat-high'
  if (ms >= 200) return 'lat-med'
  return 'lat-ok'
}

// ── Graph logic ──

async function loadGraph() {
  graphLoading.value = true
  try {
    const result = await api.serviceGraph(graphMinutes.value)
    graphNodes.value = result.nodes
    graphEdges.value = result.edges
  } catch {
    // error in api.error
  } finally {
    graphLoading.value = false
  }
}

function syncUrl() {
  const q: Record<string, string> = {}
  if (viewMode.value !== 'catalog') q.view = viewMode.value
  if (viewMode.value === 'funnels' && funnelSel.value) q.funnel = funnelSel.value.id
  router.replace({ query: q })
}

watch(viewMode, (mode) => {
  syncUrl()
  if (mode === 'graph') {
    loadGraph()
    graphInterval = setInterval(loadGraph, 30_000)
  } else {
    if (graphInterval) {
      clearInterval(graphInterval)
      graphInterval = null
    }
    loadCatalogMetrics()
  }
})

watch(catalogMinutes, () => {
  if (viewMode.value === 'catalog') loadCatalogMetrics()
})

watch(graphMinutes, () => {
  if (viewMode.value === 'graph') loadGraph()
})

onUnmounted(() => {
  if (graphInterval) clearInterval(graphInterval)
  window.removeEventListener('keydown', onFvKey)
})

// Graph layout — services are drawn as full data cards (rounded rectangles),
// always showing their metrics (name + req/s + error % + P50/P95/P99). Uniform
// size so there's no jarring resize on hover.
interface LayoutNode extends GraphNode { x: number; y: number; w: number; h: number }

const nodeCount = computed(() => graphNodes.value.length)
// Cards stay large and full of data; they shrink only slightly past ~28 services
// so a busy map still fits. dense only thins/straightens edges, never the cards.
const dense = computed(() => nodeCount.value > 16)
const CARD_W = computed(() => (nodeCount.value > 28 ? 174 : 190))
const CARD_H = computed(() => (nodeCount.value > 28 ? 92 : 100))

// Grow the canvas with the service count so the large cards have room to spread.
const SVG_W = computed(() => {
  const n = nodeCount.value
  return n <= 10 ? 1240 : Math.round(1240 + (n - 10) * 88)
})
const SVG_H = computed(() => Math.round((SVG_W.value * 2) / 3))

// Deterministic force-directed layout (no deps, no animation): seed nodes on a
// ring by index, then relax with repulsion + edge springs + centering + a
// rectangle-aware collision pass. Deterministic so the 30s auto-refresh doesn't
// make the map jump around. Small graphs stay essentially ring-shaped.
const layoutNodes = computed<LayoutNode[]>(() => {
  const nodes = graphNodes.value
  const W = SVG_W.value, H = SVG_H.value, CW = CARD_W.value, CH = CARD_H.value
  if (nodes.length === 0) return []
  const dims = nodes.map(() => ({ w: CW, h: CH }))
  const mk = (nd: GraphNode, i: number, x: number, y: number): LayoutNode =>
    ({ ...nd, x, y, w: dims[i]!.w, h: dims[i]!.h })
  if (nodes.length === 1) return [mk(nodes[0]!, 0, W / 2, H / 2)]

  const n = nodes.length
  const cx = W / 2, cy = H / 2
  // Bounding radius of each card, used for collision + edge ideal length.
  const rad = dims.map((d) => Math.hypot(d.w / 2, d.h / 2))
  const maxRad = Math.max(...rad)
  const seedR = Math.min(cx, cy) - maxRad - 14
  const pos = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / n - Math.PI / 2
    return { x: cx + seedR * Math.cos(a), y: cy + seedR * Math.sin(a) }
  })
  // Small graphs: the seed ring already looks clean, skip the simulation.
  if (n <= 6) return nodes.map((nd, i) => mk(nd, i, pos[i]!.x, pos[i]!.y))

  const idx = new Map(nodes.map((nd, i) => [nd.service_name, i]))
  const links: [number, number][] = []
  for (const e of graphEdges.value) {
    const a = idx.get(e.source), b = idx.get(e.target)
    if (a != null && b != null && a !== b) links.push([a, b])
  }
  const ideal = Math.max(maxRad * 3.4, Math.min(W, H) / Math.max(1.7, Math.sqrt(n)))
  const kRep = ideal * ideal * 1.35
  const iters = 360
  for (let it = 0; it < iters; it++) {
    const cool = 1 - it / iters
    const fx = new Array(n).fill(0), fy = new Array(n).fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i]!.x - pos[j]!.x, dy = pos[i]!.y - pos[j]!.y
        let d2 = dx * dx + dy * dy || 0.01
        const d = Math.sqrt(d2)
        let f = kRep / d2
        const minDist = rad[i]! + rad[j]! + 40
        if (d < minDist) f += (minDist - d) * 0.9 // collision: push apart hard
        const ux = dx / d, uy = dy / d
        fx[i] += ux * f; fy[i] += uy * f; fx[j] -= ux * f; fy[j] -= uy * f
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b]!.x - pos[a]!.x, dy = pos[b]!.y - pos[a]!.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d - ideal) * 0.05
      const ux = dx / d, uy = dy / d
      fx[a] += ux * f; fy[a] += uy * f; fx[b] -= ux * f; fy[b] -= uy * f
    }
    const maxStep = ideal * 0.5 * cool + 1
    for (let i = 0; i < n; i++) {
      fx[i] += (cx - pos[i]!.x) * 0.006
      fy[i] += (cy - pos[i]!.y) * 0.006
      let dx = fx[i], dy = fy[i]
      const mag = Math.sqrt(dx * dx + dy * dy)
      if (mag > maxStep) { dx = (dx / mag) * maxStep; dy = (dy / mag) * maxStep }
      const hw = dims[i]!.w / 2 + 6, hh = dims[i]!.h / 2 + 6
      pos[i]!.x = Math.max(hw, Math.min(W - hw, pos[i]!.x + dx))
      pos[i]!.y = Math.max(hh, Math.min(H - hh, pos[i]!.y + dy))
    }
  }
  return nodes.map((nd, i) => mk(nd, i, pos[i]!.x, pos[i]!.y))
})

function nodeBox(name: string): LayoutNode | null {
  return layoutNodes.value.find((n) => n.service_name === name) ?? null
}

// Clip a ray leaving a card centre to the card's rectangular border.
function clipToRect(cx: number, cy: number, hw: number, hh: number, ux: number, uy: number): { x: number; y: number } {
  const tx = ux !== 0 ? hw / Math.abs(ux) : Infinity
  const ty = uy !== 0 ? hh / Math.abs(uy) : Infinity
  const t = Math.min(tx, ty)
  return { x: cx + ux * t, y: cy + uy * t }
}

function edgePath(edge: GraphEdge): string {
  const s = nodeBox(edge.source)
  const t = nodeBox(edge.target)
  if (!s || !t) return ''
  const dx = t.x - s.x
  const dy = t.y - s.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return ''
  const ux = dx / dist, uy = dy / dist
  const a = clipToRect(s.x, s.y, s.w / 2 + 2, s.h / 2 + 2, ux, uy)
  const b = clipToRect(t.x, t.y, t.w / 2 + 4, t.h / 2 + 4, -ux, -uy)
  const bend = dense.value ? 0.05 : 0.12 // straighter edges when the map is busy
  const cx = (a.x + b.x) / 2 - (b.y - a.y) * bend
  const cy = (a.y + b.y) / 2 + (b.x - a.x) * bend
  return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
}

function edgeWidth(edge: GraphEdge): number {
  const maxReq = Math.max(...graphEdges.value.map((e) => e.request_count), 1)
  const base = dense.value ? 0.75 : 1.5
  const span = dense.value ? 2.5 : 4
  return base + (edge.request_count / maxReq) * span
}

function nodeErrorRate(n: GraphNode): number {
  return n.request_count > 0 ? n.error_count / n.request_count : 0
}

// Connecting lines are colored by the health of the calls they carry:
// green when healthy, amber (yellow) when degraded, red when unhealthy.
function edgeColor(edge: GraphEdge): string {
  const rate = edge.request_count > 0 ? edge.error_count / edge.request_count : 0
  if (rate > 0.1) return 'var(--error)'
  if (rate > 0.01) return 'var(--amber)'
  return 'var(--ok)'
}

function edgeLabelPos(edge: GraphEdge): { x: number; y: number } | null {
  const s = nodeBox(edge.source)
  const t = nodeBox(edge.target)
  if (!s || !t) return null
  const dx = t.x - s.x
  const dy = t.y - s.y
  return { x: (s.x + t.x) / 2 - dy * 0.075, y: (s.y + t.y) / 2 + dx * 0.075 }
}

// ── Service-card helpers ──
function healthClass(n: GraphNode): string {
  const r = nodeErrorRate(n)
  return r > 0.1 ? 'h-bad' : r > 0.01 ? 'h-warn' : 'h-ok'
}
function reqPerSec(n: GraphNode): string {
  const rps = n.request_count / Math.max(1, graphMinutes.value * 60)
  return rps >= 10 ? rps.toFixed(0) : rps >= 1 ? rps.toFixed(1) : rps.toFixed(2)
}
function errPct(n: GraphNode): string {
  const r = nodeErrorRate(n) * 100
  return r >= 10 ? r.toFixed(0) : r.toFixed(1)
}

// ── Pan / zoom canvas ──
// The whole graph (edges + cards) lives in one <g> that we translate + scale.
// Scroll zooms toward the cursor; drag pans. Content outside the SVG box is clipped.
const svgEl = ref<SVGSVGElement | null>(null)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const graphTransform = computed(() => `translate(${pan.value.x} ${pan.value.y}) scale(${zoom.value})`)
let panning = false
let panMoved = false
let lastVB = { x: 0, y: 0 }
const ZOOM_MIN = 0.3, ZOOM_MAX = 4

// Map a screen point (mouse) into the SVG's viewBox coordinate space.
function toViewBox(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const svg = svgEl.value
  const ctm = svg?.getScreenCTM()
  if (!svg || !ctm) return { x: 0, y: 0 }
  const pt = svg.createSVGPoint()
  pt.x = e.clientX; pt.y = e.clientY
  const loc = pt.matrixTransform(ctm.inverse())
  return { x: loc.x, y: loc.y }
}
// Re-anchor pan so the content point under `loc` stays put while zoom changes.
function applyZoom(nz: number, loc: { x: number; y: number }) {
  const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, nz))
  const cx = (loc.x - pan.value.x) / zoom.value
  const cy = (loc.y - pan.value.y) / zoom.value
  pan.value = { x: loc.x - z * cx, y: loc.y - z * cy }
  zoom.value = z
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  applyZoom(zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12), toViewBox(e))
}
function onPointerDown(e: PointerEvent) {
  panning = true; panMoved = false
  lastVB = toViewBox(e)
}
function onPointerMove(e: PointerEvent) {
  if (!panning) return
  const cur = toViewBox(e)
  const dx = cur.x - lastVB.x, dy = cur.y - lastVB.y
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) panMoved = true
  pan.value = { x: pan.value.x + dx, y: pan.value.y + dy }
  lastVB = cur
}
function onPointerUp() {
  panning = false
}
function zoomButton(k: number) {
  applyZoom(zoom.value * k, { x: SVG_W.value / 2, y: SVG_H.value / 2 })
}
function resetView() { zoom.value = 1; pan.value = { x: 0, y: 0 } }
// Navigate to the service only on a click, not at the end of a drag-pan.
function onCardClick(name: string) {
  if (panMoved) return
  router.push({ path: `/services/${encodeURIComponent(name)}`, query: { t: String(graphMinutes.value) } })
}

// ═══ Funnels tab ═══

const funnels        = ref<Funnel[]>([])
const funnelSel      = ref<Funnel | null>(null)
const funnelResult   = ref<FunnelResult | null>(null)
const funnelRunning  = ref(false)
const FUNNEL_RANGE_KEY = 'svc_funnel_range_minutes'
const funnelRange    = ref<number>(Number(localStorage.getItem(FUNNEL_RANGE_KEY)) || 60)
const funnelErr      = ref<string | null>(null)
const showFunnelForm = ref(false)
const funnelNewName  = ref('')
const funnelSteps    = ref<FunnelStep[]>([
  { label: 'Step 1', service_name: '', http_path_prefix: '' },
  { label: 'Step 2', service_name: '', http_path_prefix: '' },
])
const funnelCreateErr = ref<string | null>(null)
const deleteConfirm   = ref<string | null>(null)

const FUNNEL_RANGE_OPTS = [
  { l: '1h', v: 60 }, { l: '6h', v: 360 }, { l: '24h', v: 1440 }, { l: '7d', v: 10080 },
]

watch(viewMode, (v) => { if (v === 'funnels') loadFunnels() })
watch(funnelSel, syncUrl)

async function loadFunnels() {
  try {
    const res = await api.listFunnels()
    funnels.value = res.funnels ?? []
    const urlId = route.query.funnel as string | undefined
    if (urlId) {
      funnelSel.value = funnels.value.find(f => f.id === urlId) ?? funnels.value[0] ?? null
    } else if (funnels.value.length > 0 && !funnelSel.value) {
      funnelSel.value = funnels.value[0]!
    }
    if (funnelSel.value) runFunnel()
  } catch { /* silent */ }
}

function setFunnelRange(v: number) {
  funnelRange.value = v
  localStorage.setItem(FUNNEL_RANGE_KEY, String(v))
}

function selectFunnel(f: Funnel) {
  funnelSel.value = f
  funnelResult.value = null
  funnelErr.value = null
  runFunnel()
}

async function runFunnel() {
  if (!funnelSel.value) return
  funnelRunning.value = true
  funnelErr.value = null
  funnelResult.value = null
  try {
    const to   = new Date().toISOString()
    const from = new Date(Date.now() - funnelRange.value * 60_000).toISOString()
    funnelResult.value = await api.runFunnel(funnelSel.value.id, from, to)
  } catch (e: unknown) {
    funnelErr.value = (e as Error)?.message || 'Failed to run funnel'
  } finally {
    funnelRunning.value = false
  }
}

function addFunnelStep() {
  if (funnelSteps.value.length >= 10) return
  funnelSteps.value.push({ label: `Step ${funnelSteps.value.length + 1}`, service_name: '', http_path_prefix: '' })
}

function removeFunnelStep(i: number) {
  if (funnelSteps.value.length <= 2) return
  funnelSteps.value.splice(i, 1)
}

async function createFunnel() {
  funnelCreateErr.value = null
  if (!funnelNewName.value.trim()) { funnelCreateErr.value = 'Name required'; return }
  try {
    const steps = funnelSteps.value.map(s => ({
      label: s.label,
      ...(s.service_name    ? { service_name: s.service_name }       : {}),
      ...(s.http_path_prefix ? { http_path_prefix: s.http_path_prefix } : {}),
      ...(s.min_status_code  ? { min_status_code: Number(s.min_status_code) }  : {}),
      ...(s.max_status_code  ? { max_status_code: Number(s.max_status_code) }  : {}),
    })) as FunnelStep[]
    await api.createFunnel({ name: funnelNewName.value.trim(), steps })
    showFunnelForm.value = false
    funnelNewName.value = ''
    funnelSteps.value = [
      { label: 'Step 1', service_name: '', http_path_prefix: '' },
      { label: 'Step 2', service_name: '', http_path_prefix: '' },
    ]
    await loadFunnels()
  } catch (e: unknown) {
    funnelCreateErr.value = (e as Error)?.message || 'Failed to create funnel'
  }
}

async function deleteFunnel(id: string) {
  try {
    await api.deleteFunnel(id)
    funnels.value = funnels.value.filter(f => f.id !== id)
    if (funnelSel.value?.id === id) { funnelSel.value = funnels.value[0] ?? null; funnelResult.value = null }
    deleteConfirm.value = null
  } catch { /* silent */ }
}

function sfBarColor(p: number) {
  if (p >= 85) return '#22c55e'; if (p >= 65) return '#84cc16'
  if (p >= 45) return '#f59e0b'; if (p >= 25) return '#f97316'; return '#ef4444'
}

</script>

<template>
  <div class="services-view">
    <div class="services-header">
      <h1 class="services-title">Services</h1>
      <div class="header-controls">
        <div v-if="apmEnabled" class="view-toggle">
          <button class="toggle-btn" :class="{ active: viewMode === 'catalog' }" @click="viewMode = 'catalog'">Catalog</button>
          <button class="toggle-btn" :class="{ active: viewMode === 'graph' }" @click="viewMode = 'graph'">Graph</button>
          <button class="toggle-btn" :class="{ active: viewMode === 'funnels' }" @click="viewMode = 'funnels'">Funnels</button>
        </div>
        <div v-if="apmEnabled && viewMode === 'catalog'" class="catalog-controls">
          <div class="services-search">
            <span class="search-icon">&#9029;</span>
            <input v-model="searchFilter" class="services-search-input" placeholder="Filter services..." />
          </div>
          <TimePicker v-model="catalogMinutes" />
        </div>
        <div v-if="apmEnabled && viewMode === 'graph'" class="graph-controls">
          <TimePicker v-model="graphMinutes" />
          <button class="refresh-btn" @click="loadGraph" :disabled="graphLoading">{{ graphLoading ? '...' : 'Refresh' }}</button>
        </div>
      </div>
    </div>

    <!-- APM-disabled notice: the Services page is derived from trace/span data. -->
    <div v-if="!apmEnabled" class="empty-state card">
      <div class="empty-state-icon">&#9888;</div>
      <div>APM is disabled for this tenant</div>
      <div class="apm-notice-sub">
        The Services page is built from trace/span (APM) data. Enable the APM
        signal for this tenant in Settings &rsaquo; Tenants to use service
        catalog, dependency graph, and funnels.
      </div>
    </div>

    <!-- Catalog View -->
    <template v-if="apmEnabled && viewMode === 'catalog'">
      <div v-if="!namesLoaded" class="empty-state card">
        <div class="empty-state-icon">&#9676;</div>
        <div>Loading services...</div>
      </div>

      <div v-else-if="catalogRows.length === 0 && !catalogLoading" class="empty-state card">
        <div class="empty-state-icon">&#9707;</div>
        <div>No services found</div>
        <div class="text-muted" style="font-size: 11px">Services appear here once they start emitting trace data</div>
      </div>

      <DataTable
        v-else
        :columns="catalogColumns"
        :rows="sortedCatalogRows"
        row-key="service_name"
        :sort-key="catSortKey"
        :sort-direction="catSortDir"
        clickable-rows
        @sort="onCatalogSort"
        @row-click="openService"
      >
        <template #cell-service_name="{ row }">
          <span class="svc-dot" :class="statsLoaded ? rowHealth(row.health) : 'loading'" />
          <span class="svc-name mono">{{ row.service_name }}</span>
        </template>
        <template #cell-health="{ row }">
          <span v-if="statsLoaded" class="health-badge" :class="rowHealth(row.health)">{{ rowHealth(row.health) }}</span>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-request_count="{ row }">
          <template v-if="statsLoaded">{{ formatCount(rowNumber(row.request_count)) }}</template>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-error_count="{ row }">
          <template v-if="statsLoaded"><span :class="{ 'status-error': rowNumber(row.error_count) > 0 }">{{ formatCount(rowNumber(row.error_count)) }}</span></template>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-error_rate="{ row }">
          <template v-if="statsLoaded"><span :class="{ 'status-error': rowNumber(row.error_rate) > 0.05, 'status-warn': rowNumber(row.error_rate) > 0.01 && rowNumber(row.error_rate) <= 0.05 }">{{ formatPercent(rowNumber(row.error_rate)) }}</span></template>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-p50_ms="{ row }">
          <template v-if="statsLoaded"><span :class="latencyClass(rowNumber(row.p50_ms))">{{ formatMs(rowNumber(row.p50_ms)) }}</span></template>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-p95_ms="{ row }">
          <template v-if="statsLoaded"><span :class="latencyClass(rowNumber(row.p95_ms))">{{ formatMs(rowNumber(row.p95_ms)) }}</span></template>
          <span v-else class="stat-placeholder"></span>
        </template>
        <template #cell-p99_ms="{ row }">
          <template v-if="statsLoaded"><span :class="latencyClass(rowNumber(row.p99_ms))">{{ formatMs(rowNumber(row.p99_ms)) }}</span></template>
          <span v-else class="stat-placeholder"></span>
        </template>
      </DataTable>
    </template>

    <!-- Graph View -->
    <template v-if="apmEnabled && viewMode === 'graph'">
      <div v-if="graphLoading && graphNodes.length === 0" class="empty-state card">
        <div class="empty-state-icon">&#9676;</div>
        <div>Loading service graph...</div>
      </div>

      <div v-else-if="graphNodes.length === 0" class="empty-state card">
        <div class="empty-state-icon">&#9707;</div>
        <div>No service data in this time range</div>
        <div class="text-muted" style="font-size: 11px">Try increasing the time range or check that services are emitting traces</div>
      </div>

      <div v-else class="graph-container card">
        <svg ref="svgEl" :viewBox="`0 0 ${SVG_W} ${SVG_H}`" class="graph-svg" :class="{ panning }"
             :style="{ height: '74vh', maxHeight: 'none' }" preserveAspectRatio="xMidYMid meet"
             @wheel.prevent="onWheel" @pointerdown="onPointerDown" @pointermove="onPointerMove"
             @pointerup="onPointerUp" @pointerleave="onPointerUp">
          <defs>
            <!-- context-stroke makes each arrowhead inherit its line's color (green/amber/red). -->
            <marker id="arrowhead" markerWidth="7" markerHeight="6" refX="7" refY="3" orient="auto">
              <polygon points="0 0, 7 3, 0 6" fill="context-stroke" opacity="0.75" />
            </marker>
          </defs>
          <g :transform="graphTransform">
            <g v-for="edge in graphEdges" :key="`${edge.source}-${edge.target}`">
              <path :d="edgePath(edge)" fill="none" :stroke="edgeColor(edge)" :stroke-width="edgeWidth(edge)" :stroke-opacity="dense ? 0.55 : 0.7" marker-end="url(#arrowhead)" />
              <text v-if="!dense && edgeLabelPos(edge)" :x="edgeLabelPos(edge)!.x" :y="edgeLabelPos(edge)!.y" class="edge-label" text-anchor="middle" dominant-baseline="central">{{ formatCount(edge.request_count) }} req</text>
            </g>
            <!-- Service cards: always-on data cards (name + req/s + errors + P50/P95/P99). -->
            <foreignObject v-for="node in layoutNodes" :key="node.service_name"
                           :x="node.x - node.w / 2" :y="node.y - node.h / 2" :width="node.w" :height="node.h"
                           style="overflow: visible">
              <div xmlns="http://www.w3.org/1999/xhtml" class="svc-fcard" :class="healthClass(node)"
                   :title="node.service_name" @click="onCardClick(node.service_name)">
                <div class="svc-fhead">
                  <span class="svc-fname">{{ node.service_name }}</span>
                  <span class="svc-fopen">↗</span>
                </div>
                <div class="svc-fgrid">
                  <div class="svc-fcell"><div class="svc-fl">Requests</div><div class="svc-fv">{{ reqPerSec(node) }}/s</div></div>
                  <div class="svc-fcell"><div class="svc-fl">Errors</div><div class="svc-fv" :class="{ bad: nodeErrorRate(node) > 0.01 }">{{ errPct(node) }}%</div></div>
                  <div class="svc-fcell"><div class="svc-fl">P50</div><div class="svc-fv">{{ formatMs(node.p50_ms) }}</div></div>
                  <div class="svc-fcell"><div class="svc-fl">P95</div><div class="svc-fv">{{ formatMs(node.p95_ms) }}</div></div>
                  <div class="svc-fcell"><div class="svc-fl">P99</div><div class="svc-fv">{{ formatMs(node.p99_ms) }}</div></div>
                </div>
              </div>
            </foreignObject>
          </g>
        </svg>
        <div class="graph-zoom">
          <button class="gz-btn" title="Zoom in" @click="zoomButton(1.2)">+</button>
          <button class="gz-btn" title="Zoom out" @click="zoomButton(1 / 1.2)">−</button>
          <button class="gz-btn gz-reset" title="Reset view" @click="resetView">⤢</button>
        </div>
        <div class="graph-legend">
          <div class="legend-item"><span class="legend-dot" style="background: var(--ok)"></span><span>Healthy (&lt;1%)</span></div>
          <div class="legend-item"><span class="legend-dot" style="background: var(--amber)"></span><span>Degraded (1-10%)</span></div>
          <div class="legend-item"><span class="legend-dot" style="background: var(--error)"></span><span>Unhealthy (&gt;10%)</span></div>
          <div class="legend-item text-muted" style="margin-left: auto; font-size: 10px">Line thickness = traffic volume · scroll to zoom · drag to pan</div>
        </div>
      </div>
    </template>

    <!-- Funnels View -->
    <template v-if="apmEnabled && viewMode === 'funnels'">
      <div class="fv-layout">
        <!-- Left sidebar: list -->
        <div class="fv-sidebar">
          <div class="fv-sidebar-head">
            <span class="fv-sidebar-title">Funnels</span>
            <button v-if="canWrite" class="fv-new-btn" @click="funnelNewName = ''; funnelSteps = [{ label: 'Step 1', service_name: '', http_path_prefix: '' }, { label: 'Step 2', service_name: '', http_path_prefix: '' }]; funnelCreateErr = null; showFunnelForm = true">+ New</button>
          </div>

          <!-- Funnel list -->
          <div v-if="funnels.length === 0" class="fv-empty card">
            <div class="fv-empty-icon">▽</div>
            <div>No funnels yet</div>
            <div class="fv-empty-sub">Analyze trace drop-off across your services</div>
          </div>

          <div
            v-for="f in funnels" :key="f.id"
            class="fv-item"
            :class="{ selected: funnelSel?.id === f.id }"
            @click="selectFunnel(f)"
          >
            <div class="fv-item-info">
              <div class="fv-item-name">{{ f.name }}</div>
              <div class="fv-item-meta">{{ f.steps.length }} steps</div>
            </div>
            <template v-if="canWrite">
              <button v-if="deleteConfirm !== f.id" class="fv-del-btn" @click.stop="deleteConfirm = f.id" title="Delete">✕</button>
              <span v-else class="fv-del-confirm" @click.stop>
                <button class="fv-confirm-yes" @click="deleteFunnel(f.id)">Delete</button>
                <button class="fv-confirm-no"  @click="deleteConfirm = null">Cancel</button>
              </span>
            </template>
          </div>
        </div>

        <!-- Right panel: run + visualization -->
        <div class="fv-main">
          <div v-if="!funnelSel" class="fv-empty card" style="height:180px">
            <div class="fv-empty-icon">▽</div>
            <div>Select a funnel to analyze</div>
          </div>

          <template v-else>
            <div class="fv-run-header">
              <h3 class="fv-run-title">{{ funnelSel.name }}</h3>
              <div class="fv-run-controls">
                <div class="fv-range-row">
                  <button v-for="opt in FUNNEL_RANGE_OPTS" :key="opt.v"
                    class="fv-range-btn" :class="{ active: funnelRange === opt.v }"
                    @click="setFunnelRange(opt.v)">{{ opt.l }}</button>
                </div>
                <button class="fv-run-btn" @click="runFunnel" :disabled="funnelRunning">
                  <span v-if="funnelRunning" class="fv-spin">⟳</span>
                  <span v-else>▶ Run Funnel</span>
                </button>
              </div>
            </div>

            <!-- Steps preview pills -->
            <div class="fv-steps-flow card">
              <div class="fv-steps-flow-title">Steps</div>
              <div class="fv-flow-list">
                <template v-for="(step, i) in funnelSel.steps" :key="i">
                  <div class="fv-flow-pill">
                    <span class="fv-flow-num">{{ i + 1 }}</span>
                    <div class="fv-flow-info">
                      <div class="fv-flow-label">{{ step.label }}</div>
                      <div class="fv-flow-meta mono">
                        <span v-if="step.service_name">{{ step.service_name }}</span>
                        <span v-if="step.http_path_prefix"> {{ step.http_path_prefix }}</span>
                        <span v-if="step.min_status_code"> {{ step.min_status_code }}–{{ step.max_status_code ?? '∞' }}</span>
                      </div>
                    </div>
                  </div>
                  <div v-if="i < funnelSel.steps.length - 1" class="fv-flow-arrow">→</div>
                </template>
              </div>
            </div>

            <div v-if="funnelErr" class="fv-err-block card">{{ funnelErr }}</div>

            <!-- Result -->
            <div v-if="funnelResult" class="fv-result card">
              <!-- Banner -->
              <div class="fv-banner">
                <span class="fv-banner-label">OVERALL FUNNEL METRICS</span>
                <span class="fv-banner-rate">
                  Conversion rate —
                  <strong :style="{ color: sfBarColor(funnelResult.steps[funnelResult.steps.length - 1]!.pct_of_first) }">
                    {{ funnelResult.steps[funnelResult.steps.length - 1]!.pct_of_first.toFixed(1) }}%
                  </strong>
                </span>
              </div>

              <!-- Summary stats -->
              <div class="fv-summary-row">
                <div class="fv-summary-stat">
                  <div class="fv-summary-val">{{ funnelResult.steps[0]!.count.toLocaleString() }}</div>
                  <div class="fv-summary-key">Total Traces</div>
                </div>
                <div class="fv-summary-divider"></div>
                <div class="fv-summary-stat">
                  <div class="fv-summary-val fv-val-drop">
                    {{ (funnelResult.steps[0]!.count - funnelResult.steps[funnelResult.steps.length - 1]!.count).toLocaleString() }}
                  </div>
                  <div class="fv-summary-key">Dropped</div>
                </div>
                <div class="fv-summary-divider"></div>
                <div class="fv-summary-stat">
                  <div class="fv-summary-val fv-val-good">{{ funnelResult.steps[funnelResult.steps.length - 1]!.count.toLocaleString() }}</div>
                  <div class="fv-summary-key">Completed</div>
                </div>
              </div>

              <!-- Vertical bar chart -->
              <div class="fv-chart">
                <div v-for="(step, i) in funnelResult.steps" :key="i" class="fv-chart-col">
                  <div class="fv-chart-bar-wrap">
                    <div class="fv-chart-bar"
                      :style="{ height: `${Math.max(i === 0 ? 100 : step.pct_of_first, 2)}%`, background: sfBarColor(i === 0 ? 100 : step.pct_of_first) }">
                    </div>
                  </div>
                  <div class="fv-chart-meta">
                    <div class="fv-chart-pct" :style="{ color: sfBarColor(i === 0 ? 100 : step.pct_of_first) }">
                      {{ i === 0 ? '100%' : step.pct_of_first.toFixed(1) + '%' }}
                    </div>
                    <div class="fv-chart-num mono">{{ step.count.toLocaleString() }}</div>
                    <div v-if="i > 0" class="fv-chart-drop">−{{ step.drop_off.toLocaleString() }}</div>
                    <div class="fv-chart-lbl">
                      <span class="fv-chart-step-num">{{ i + 1 }}</span>
                      {{ step.label }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Per-transition rows -->
              <div v-if="funnelResult.steps.length > 1" class="fv-transitions">
                <div v-for="(step, i) in funnelResult.steps.slice(1)" :key="i" class="fv-transition-row">
                  <div class="fv-tr-title">
                    <span class="fv-tr-num">{{ i + 1 }}</span>
                    <span class="fv-tr-name">{{ funnelResult.steps[i]!.label }}</span>
                    <span class="fv-tr-arrow">→</span>
                    <span class="fv-tr-num">{{ i + 2 }}</span>
                    <span class="fv-tr-name">{{ step.label }}</span>
                  </div>
                  <div class="fv-tr-stats">
                    <div class="fv-tr-stat">
                      <div class="fv-tr-val mono">{{ funnelResult.steps[i]!.count.toLocaleString() }}</div>
                      <div class="fv-tr-key">Total</div>
                    </div>
                    <div class="fv-tr-stat">
                      <div class="fv-tr-val mono fv-val-drop">{{ step.drop_off.toLocaleString() }}</div>
                      <div class="fv-tr-key">Dropped</div>
                    </div>
                    <div class="fv-tr-stat">
                      <div class="fv-tr-val mono fv-val-good">{{ step.count.toLocaleString() }}</div>
                      <div class="fv-tr-key">Completed</div>
                    </div>
                    <div class="fv-tr-stat">
                      <div class="fv-tr-val mono" :style="{ color: sfBarColor(step.pct_of_prev) }">{{ step.pct_of_prev.toFixed(1) }}%</div>
                      <div class="fv-tr-key">Conv. Rate</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Create funnel slide-out drawer -->
      <Transition name="fv-drawer">
        <div v-if="showFunnelForm && canWrite" class="fv-drawer-overlay" @click.self="showFunnelForm = false">
          <div class="fv-drawer">
            <div class="fv-drawer-header">
              <div class="fv-drawer-title-row">
                <h3 class="fv-drawer-title">New Funnel</h3>
                <button class="fv-drawer-close" @click="showFunnelForm = false" aria-label="Close">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
            <div class="fv-drawer-body">
              <div class="fv-form">
                <div class="fv-field">
                  <label class="fv-label">Name</label>
                  <input class="fv-input" v-model="funnelNewName" placeholder="e.g. Checkout flow" />
                </div>
                <div class="fv-steps">
                  <div v-for="(step, i) in funnelSteps" :key="i" class="fv-step-card">
                    <div class="fv-step-head">
                      <span class="fv-step-num">{{ i + 1 }}</span>
                      <button v-if="funnelSteps.length > 2" class="fv-step-rm" @click="removeFunnelStep(i)">✕</button>
                    </div>
                    <div class="fv-field"><label class="fv-label">Label</label><input class="fv-input" v-model="step.label" /></div>
                    <div class="fv-field">
                      <label class="fv-label">Service</label>
                      <input class="fv-input" v-model="step.service_name" placeholder="service-name"
                        list="fv-service-names" autocomplete="off" />
                    </div>
                    <div class="fv-field"><label class="fv-label">Path</label><input class="fv-input mono" v-model="step.http_path_prefix" placeholder="/api/..." /></div>
                    <div class="fv-row2">
                      <div class="fv-field"><label class="fv-label">Min status</label><input class="fv-input" type="number" v-model.number="step.min_status_code" placeholder="200" /></div>
                      <div class="fv-field"><label class="fv-label">Max status</label><input class="fv-input" type="number" v-model.number="step.max_status_code" placeholder="299" /></div>
                    </div>
                  </div>
                </div>
                <button class="fv-add-step" @click="addFunnelStep" :disabled="funnelSteps.length >= 10">+ Add Step</button>
                <div v-if="funnelCreateErr" class="fv-err">{{ funnelCreateErr }}</div>
              </div>
            </div>
            <datalist id="fv-service-names">
              <option v-for="svc in serviceNames" :key="svc" :value="svc" />
            </datalist>
            <div class="fv-drawer-footer">
              <button class="fv-btn" @click="showFunnelForm = false">Cancel</button>
              <button class="fv-btn fv-btn-primary" @click="createFunnel">Create</button>
            </div>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped src="../styles/views/ServicesView.css"></style>
