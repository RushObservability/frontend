import { describe, expect, it } from 'vitest'
import { preferredDatabaseScope, sortDatabaseScopes } from './integrationDatabaseScope'

describe('integration database scope', () => {
  const databases = sortDatabaseScopes([
    { host: 'db-b.internal', db: 'warehouse10' },
    { host: 'db-a.internal', db: 'users' },
    { host: 'db-a.internal', db: 'app' },
    { host: 'db-a.internal', db: 'warehouse2' },
  ])

  it('sorts database names alphabetically with natural number ordering', () => {
    expect(databases.map(({ db }) => db)).toEqual([
      'app',
      'users',
      'warehouse2',
      'warehouse10',
    ])
  })

  it('keeps a valid database selection', () => {
    expect(preferredDatabaseScope(databases, 'db-a.internal', 'users')).toEqual({
      host: 'db-a.internal',
      db: 'users',
    })
  })

  it('defaults to the first alphabetical database', () => {
    expect(preferredDatabaseScope(databases, '', '')).toEqual({
      host: 'db-a.internal',
      db: 'app',
    })
  })
})
