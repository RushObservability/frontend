import type { Group, User } from '../../types'

export type UserRole = 'admin' | 'write' | 'viewer' | 'unknown'
export type UserStatus = 'all' | 'enabled' | 'disabled'

export function directoryRole(groupIds: string[] | undefined, groups: Group[]): UserRole {
  if (!groupIds || groupIds.some(id => !groups.some(group => group.id === id))) return 'unknown'
  const permissions = groups.filter(group => groupIds.includes(group.id)).flatMap(group => group.permissions)
  if (permissions.includes('admin')) return 'admin'
  if (permissions.includes('write')) return 'write'
  return 'viewer'
}

export function filterDirectoryUsers(
  users: User[], groups: Group[], memberships: Record<string, string[]>,
  query: string, role: UserRole | 'all', status: UserStatus,
): User[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return users.filter(user => {
    const ids = memberships[user.id]
    const userRole = directoryRole(ids, groups)
    if (role !== 'all' && userRole !== role) return false
    if (status !== 'all' && user.enabled !== (status === 'enabled')) return false
    const groupNames = (ids ?? []).map(id => groups.find(group => group.id === id)?.name ?? id)
    const roleTerms = userRole === 'viewer' ? 'viewer read read-only' : userRole === 'admin' ? 'admin administrator' : userRole
    const text = [user.id, user.username, user.display_name, user.tenant_id, roleTerms,
      user.enabled ? 'enabled' : 'disabled', ...groupNames].join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  }).sort((a, b) => a.username.localeCompare(b.username, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id))
}
