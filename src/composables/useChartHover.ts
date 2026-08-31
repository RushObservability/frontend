import { inject, provide, ref, type InjectionKey, type Ref } from 'vue'

// Shared hover state for synchronising a crosshair across every chart on a page.
// Keyed on TIME (epoch seconds), not on a pixel/index ratio, so the vertical line
// lands on the same timestamp on each chart even when their series have different
// point counts or slightly different start/end times.
export interface ChartHover {
  /** Hovered time in epoch seconds, or null when no chart is hovered. */
  time: Ref<number | null>
  /** Id of the chart the cursor is actually over (only it shows a tooltip). */
  activeId: Ref<string | null>
  set: (t: number | null, id?: string | null) => void
}

export const CHART_HOVER_KEY: InjectionKey<ChartHover> = Symbol('chart-hover')

function makeHover(): ChartHover {
  const time = ref<number | null>(null)
  const activeId = ref<string | null>(null)
  return {
    time,
    activeId,
    set: (t, id = null) => {
      time.value = t
      activeId.value = t == null ? null : id
    },
  }
}

/** Call once in a page/container (e.g. DashboardView) to share a crosshair across its charts. */
export function provideChartHover(): ChartHover {
  const hover = makeHover()
  provide(CHART_HOVER_KEY, hover)
  return hover
}

/**
 * Use inside a chart. Returns the page-shared hover when a provider exists
 * (charts sync), otherwise a chart-local hover so standalone charts still get
 * their own crosshair/tooltip without cross-chart syncing.
 */
export function useChartHover(): ChartHover {
  return inject(CHART_HOVER_KEY, null) ?? makeHover()
}
