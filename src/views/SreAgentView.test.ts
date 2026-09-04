import { describe, expect, it } from 'vitest'
import panelSource from '../components/InvestigationPanel.vue?raw'
import navigationSource from '../navigation.ts?raw'
import routerSource from '../router.ts?raw'
import viewSource from './SreAgentView.vue?raw'

describe('SRE Agent saved-session navigation', () => {
  it('passes the selected row id into the investigation panel', () => {
    expect(viewSource).toContain('selectedSessionId.value = id')
    expect(viewSource).toContain(':initial-session-id="selectedSessionId"')
    expect(viewSource).not.toContain("launch(String(row.question || row.title || ''))")
  })

  it('gives saved investigations a stable route and real link', () => {
    expect(routerSource).toContain("path: '/sre-agent/:sessionId'")
    expect(routerSource).toContain("name: 'sre-agent-session'")
    expect(navigationSource).toContain("'sre-agent-session'")
    expect(viewSource).toContain("params: { sessionId: String(row.id) }")
    expect(viewSource).toContain("void router.push({ name: 'sre-agent-session'")
    expect(panelSource).toContain("watch(() => props.initialSessionId")
  })

  it('loads a saved session before considering the auto-start path', () => {
    const restore = panelSource.indexOf('if (props.initialSessionId)')
    const start = panelSource.indexOf('else if (props.question || props.eventId)')

    expect(restore).toBeGreaterThan(-1)
    expect(start).toBeGreaterThan(restore)
    expect(panelSource).toContain('await loadSession(props.initialSessionId)')
    expect(panelSource).toContain('parseStoredActivity(t.tool_calls)')
    expect(panelSource).toContain('tIdx > 0 || props.initialSessionId')
  })
})
