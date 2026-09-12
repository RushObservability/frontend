export interface ProfileStack { frames: string[]; cpu_seconds: number }
export interface ProfileResult {
  stacks: ProfileStack[]
  total_cpu_seconds: number
  from: number
  to: number
  attribution: 'service' | 'linked_samples'
}
export interface ProfileSeries { service: string; version: string; pod: string; profile_type: 'cpu' | 'sampled_cpu' }
export interface ProfileQuery {
  from: number; to: number; service?: string; version?: string; pod?: string
  trace_id?: string; span_id?: string
  profile_type?: string
}
export interface FlameNode {
  name: string; path: string[]; total: number; self: number; children: FlameNode[]
}

export function buildFlameTree(stacks: ProfileStack[]): FlameNode {
  const root: FlameNode = { name: 'All CPU samples', path: [], total: 0, self: 0, children: [] }
  for (const stack of stacks) {
    if (!Number.isFinite(stack.cpu_seconds) || stack.cpu_seconds <= 0 || !stack.frames.length) continue
    let node = root
    node.total += stack.cpu_seconds
    for (const name of stack.frames) {
      let child = node.children.find(c => c.name === name)
      if (!child) {
        child = { name, path: [...node.path, name], total: 0, self: 0, children: [] }
        node.children.push(child)
      }
      child.total += stack.cpu_seconds
      node = child
    }
    node.self += stack.cpu_seconds
  }
  return root
}

export interface FlameRect { node: FlameNode; x: number; width: number; depth: number }
export function layoutFlameTree(root: FlameNode): FlameRect[] {
  if (root.total <= 0) return []
  const rects: FlameRect[] = []
  const visit = (node: FlameNode, x: number, depth: number) => {
    const width = node.total / root.total * 100
    rects.push({ node, x, width, depth })
    let childX = x
    for (const child of [...node.children].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))) {
      visit(child, childX, depth + 1)
      childX += child.total / root.total * 100
    }
  }
  visit(root, 0, 0)
  return rects
}

export function profileFunctions(current: ProfileStack[], baseline: ProfileStack[] = []) {
  const rows = new Map<string, { name: string; self: number; total: number; baseline: number; share: number; delta: number }>()
  const sum = (s: ProfileStack[]) => s.reduce((n, r) => n + r.cpu_seconds, 0)
  const total = sum(current)
  const before = sum(baseline)
  const get = (name: string) => {
    let row = rows.get(name)
    if (!row) { row = { name, self: 0, total: 0, baseline: 0, share: 0, delta: 0 }; rows.set(name, row) }
    return row
  }
  for (const s of current) {
    // Recursive calls count once towards a function's inclusive CPU.
    for (const name of new Set(s.frames)) get(name).total += s.cpu_seconds
    const leaf = s.frames.at(-1)
    if (leaf) get(leaf).self += s.cpu_seconds
  }
  for (const s of baseline) {
    const leaf = s.frames.at(-1)
    if (leaf) get(leaf).baseline += s.cpu_seconds
  }
  for (const r of rows.values()) {
    r.share = total > 0 ? r.self / total * 100 : 0
    r.delta = r.share - (before > 0 ? r.baseline / before * 100 : 0)
  }
  return [...rows.values()].sort((a, b) => b.self - a.self || a.name.localeCompare(b.name))
}

export function cpuTime(seconds: number): string {
  return seconds < 1 ? `${(seconds * 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} ms` : `${seconds.toLocaleString(undefined, { maximumFractionDigits: 3 })} s`
}

export function relatedProfileLocation(service: string, timestamp: string | number, durationNs: number) {
  const start = typeof timestamp === 'number' ? timestamp / 1e6 : Date.parse(timestamp)
  const end = start + Math.max(0, durationNs / 1e6) + 60_000
  if (!service || !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(new Date(end).getTime()) || start < 60_000) return null
  return { name: 'profiles', query: { service, from: new Date(start - 60_000).toISOString(), to: new Date(end).toISOString() } }
}
