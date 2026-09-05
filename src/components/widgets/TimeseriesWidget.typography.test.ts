import { describe, expect, it } from 'vitest'
// @ts-expect-error The app tsconfig intentionally excludes Node built-in declarations.
import { readFileSync } from 'fs'
import componentSource from './TimeseriesWidget.vue?raw'

const styleSource = readFileSync(new URL('../../styles/widgets/TimeseriesWidget.css', import.meta.url), 'utf8')

describe('time-series axis typography', () => {
  it('renders axis labels outside the stretched SVG', () => {
    expect(componentSource).toContain('class="ts-axis-layer"')
    expect(componentSource).toContain('class="ts-axis-label ts-axis-label--left"')
    expect(componentSource).toContain('class="ts-axis-label ts-axis-label--bottom"')
    expect(componentSource).toContain('class="ts-reference-label ts-threshold-label"')
    expect(componentSource).not.toContain('class="ch-axis"')
    expect(componentSource).not.toContain('class="ch-threshold-label"')
  })

  it('matches the Explore chart axis type treatment', () => {
    expect(styleSource).toContain('font: 500 var(--panel-chart-axis-size) / 1 var(--font-mono)')
    expect(styleSource).toContain("letter-spacing: -.025em")
    expect(styleSource).toContain('font-variant-numeric: tabular-nums')
    expect(styleSource).not.toContain('.ts-svg .ch-axis { font-size: 6px; }')
  })
})
