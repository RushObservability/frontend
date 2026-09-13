import { describe, expect, it } from 'vitest'
import type { Group, User } from '../../types'
import { directoryRole, filterDirectoryUsers } from './userDirectory'

const groups: Group[] = [
  { id: 'a', name: 'Operations', permissions: ['admin'] },
  { id: 'w', name: 'Developers', permissions: ['write'] },
  { id: 'v', name: 'Viewers', permissions: ['read'] },
].map(group => ({ description: '', scopes: [], system: false, tenant_ids: [], created_at: '', ...group }))
const users: User[] = [
  { id: '1', username: 'alex@example.com', display_name: 'Alex Chen', enabled: true },
  { id: '2', username: 'demo-user-010', display_name: 'Sam Patel', enabled: false },
  { id: '3', username: 'demo-user-002', display_name: 'Taylor Williams', enabled: true },
].map(user => ({ tenant_id: 'default', created_at: '', ...user }))
const memberships = { '1': ['a'], '2': ['w'], '3': ['v'] }

describe('user directory', () => {
  it('matches the API role precedence and does not guess missing group data', () => {
    expect(directoryRole(['w', 'a'], groups)).toBe('admin')
    expect(directoryRole(['v', 'w'], groups)).toBe('write')
    expect(directoryRole([], groups)).toBe('viewer')
    expect(directoryRole(undefined, groups)).toBe('unknown')
    expect(directoryRole(['missing'], groups)).toBe('unknown')
  })
  it.each(['ALEX@EXAMPLE.COM', 'alex chen', 'admin', 'Operations', 'default alex', '  alex   chen  '])('searches all fields case-insensitively: %s', query => {
    expect(filterDirectoryUsers(users, groups, memberships, query, 'all', 'all').map(user => user.id)).toEqual(['1'])
  })
  it('combines role, status, and multiple search terms', () => {
    expect(filterDirectoryUsers(users, groups, memberships, 'sam developers', 'write', 'disabled').map(user => user.id)).toEqual(['2'])
    expect(filterDirectoryUsers(users, groups, memberships, 'sam', 'admin', 'all')).toEqual([])
    expect(filterDirectoryUsers(users, groups, memberships, '', 'all', 'enabled')).toHaveLength(2)
    expect(filterDirectoryUsers(users, groups, memberships, 'read-only', 'viewer', 'all')).toHaveLength(1)
  })
  it('sorts usernames naturally without mutating the API list', () => {
    expect(filterDirectoryUsers(users, groups, memberships, '  ', 'all', 'all').map(user => user.id)).toEqual(['1', '3', '2'])
    expect(users.map(user => user.id)).toEqual(['1', '2', '3'])
  })
  it('handles empty and literal special-character searches', () => {
    expect(filterDirectoryUsers([], groups, {}, '', 'all', 'all')).toEqual([])
    expect(filterDirectoryUsers(users, groups, memberships, '[.*', 'all', 'all')).toEqual([])
  })
})
