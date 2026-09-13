import type { CountBucket, DeployMarker, TimeDomain, WidgetQueryConfig } from '../../types'
import type { TableWidgetColumn } from '../widgets/table'

export type PanelVariant = 'chart' | 'stat' | 'bar' | 'table'
export type PanelTone = 'default' | 'positive' | 'warning' | 'danger'

export interface PanelFrameProps {
  title: string
  description?: string
  caption?: string
  sourceLabel?: string
  rangeLabel?: string
  loading?: boolean
  error?: string | null
  emptyTitle?: string
  emptyMessage?: string
}

export interface TimeSeriesPanelSeries {
  name: string
  points: [number, number][]
  color?: string
  ref_id?: string
  axis?: 'left' | 'right'
  legendValue?: number
  lineStyle?: 'solid' | 'dashed'
  opacity?: number
}

export interface TimeSeriesPanelProps extends PanelFrameProps {
  displayMode?: 'lines' | 'stacked-bars'
  /** Width of each bar's time bucket, in seconds. */
  bucketSeconds?: number
  buckets?: CountBucket[]
  series?: TimeSeriesPanelSeries[]
  timeDomain?: TimeDomain
  deploys?: DeployMarker[]
  thresholds?: Array<{ value: number; color: string; label: string }>
  /** Keep the chart canvas visible without samples, useful while configuring reference lines. */
  showChartWhenEmpty?: boolean
  unit?: string
  seriesName?: string
}

export interface StatPanelProps extends PanelFrameProps {
  value: number
  label?: string
  unit?: string
  tone?: PanelTone
  precision?: number
}

export interface BarPanelProps extends PanelFrameProps {
  groups?: Array<{ key: string; count: number }>
}

export interface HistogramPanelProps extends PanelFrameProps {
  bins?: Array<{ key: string; count: number }>
  markers?: Array<{ position: number; label: string; value?: string; color?: string }>
  minLabel?: string
  maxLabel?: string
  color?: string
  unit?: string
}

export interface TablePanelProps extends PanelFrameProps {
  rows?: Record<string, unknown>[]
  columns?: TableWidgetColumn[]
}

export type PanelQueryConfig = Pick<WidgetQueryConfig, 'source' | 'queries'>
