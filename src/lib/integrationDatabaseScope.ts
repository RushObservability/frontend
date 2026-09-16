export interface IntegrationDatabaseScope {
  host: string
  db: string
}

const databaseCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export function sortDatabaseScopes(
  scopes: IntegrationDatabaseScope[],
): IntegrationDatabaseScope[] {
  return [...scopes].sort((a, b) => (
    databaseCollator.compare(a.db, b.db)
    || databaseCollator.compare(a.host, b.host)
  ))
}

export function preferredDatabaseScope(
  scopes: IntegrationDatabaseScope[],
  selectedHost: string,
  selectedDb: string,
): IntegrationDatabaseScope | undefined {
  if (!scopes.length) return undefined

  const exact = scopes.find((scope) => (
    scope.host === selectedHost && scope.db === selectedDb
  ))
  if (exact) return exact

  if (selectedDb) {
    const matchingDatabase = scopes.find((scope) => scope.db === selectedDb)
    if (matchingDatabase) return matchingDatabase
  }

  return scopes[0]
}
