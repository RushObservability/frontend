// Grafana-style template-variable substitution for dashboard widgets.
//
// Tokens `$name` and `${name}` in queries / titles are replaced with the
// selected value from the variable bar. The "All" selection (VAR_ALL sentinel)
// has context-specific semantics:
//   - filters:  the filter is DROPPED entirely (show all)
//   - promql:   the token expands to `.*` (use inside a =~ matcher)
//   - titles:   the token renders as `*`
import type { Filter } from '../types'
import { VAR_ALL } from '../types'

const TOKEN_RE = /\$\{(\w+)\}|\$(\w+)/g

/** Variable names referenced by a string (e.g. "$service" → ["service"]). */
export function referencedVars(str: string): string[] {
  const out: string[] = []
  for (const m of str.matchAll(TOKEN_RE)) out.push(m[1] || m[2]!)
  return out
}

/**
 * Replace `$name` / `${name}` tokens with selected values. A value of VAR_ALL
 * becomes `allValue` (default "*"). Unknown variables are left untouched.
 */
export function substitute(
  str: string,
  varValues: Record<string, string>,
  allValue = '*',
): string {
  if (!str) return str
  return str.replace(TOKEN_RE, (full, braced, bare) => {
    const name = (braced || bare) as string
    if (!(name in varValues)) return full
    const v = varValues[name]!
    return v === VAR_ALL ? allValue : v
  })
}

/**
 * Apply variable values to span/log filters: drop any filter whose value
 * references a variable currently set to "All"; otherwise substitute tokens.
 */
export function applyVarsToFilters(
  filters: Filter[],
  varValues: Record<string, string>,
): Filter[] {
  const out: Filter[] = []
  for (const f of filters) {
    const raw = String(f.value)
    const refs = referencedVars(raw)
    if (refs.some((n) => varValues[n] === VAR_ALL)) continue // "All" → omit filter
    out.push({ ...f, value: refs.length ? substitute(raw, varValues) : f.value })
  }
  return out
}
