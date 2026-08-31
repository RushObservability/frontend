export type ContextMenuIcon =
  | 'filter'
  | 'exclude'
  | 'copy'
  | 'logs'
  | 'apm'
  | 'trace'

export interface ContextMenuItem {
  label: string
  icon?: ContextMenuIcon
  action: () => void
  separator?: false
  disabled?: boolean
}

export interface ContextMenuSeparator {
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator
