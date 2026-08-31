export type TableWidgetFormat =
  | 'auto'
  | 'number'
  | 'duration-ms'
  | 'duration-s'
  | 'bytes'
  | 'boolean'

export interface TableWidgetColumn {
  key: string
  label: string
  description?: string
  width?: string
  align?: 'left' | 'center' | 'right'
  format?: TableWidgetFormat
  monospace?: boolean
}
