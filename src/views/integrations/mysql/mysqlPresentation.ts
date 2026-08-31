import type { TableWidgetColumn } from '../../../components/widgets/table'
import type { LogRecord } from '../../../types'

export type MySqlView =
  | 'overview'
  | 'queries'
  | 'activity'
  | 'waits'
  | 'locks'
  | 'tables'
  | 'indexes'
  | 'replication'
  | 'capacity'
  | 'advisor'
  | 'errors'

export interface MySqlViewMeta {
  eyebrow: string
  title: string
  description: string
  guide: string
  terms: Array<{ term: string; meaning: string }>
  events: string[]
}

const column = (
  key: string,
  label: string,
  width: string,
  description: string,
  options: Pick<TableWidgetColumn, 'align' | 'format' | 'monospace'> = {},
): TableWidgetColumn => ({ key, label, width, description, ...options })

const findingsColumns: TableWidgetColumn[] = [
  column('severity', 'Priority', '88px', 'Warning items deserve review. Info items are context, not incidents.'),
  column('item', 'What Rush found', '220px', 'A plain-language name for the observed condition.'),
  column('current', 'Current value', '116px', 'The setting or value MySQL reported.'),
  column('evidence', 'Evidence', '340px', 'The database object or observation behind this finding.'),
  column('next_step', 'What to do', '380px', 'A safe next step. Rush never changes MySQL for you.'),
]

export const MYSQL_TABLE_COLUMNS: Partial<Record<MySqlView, TableWidgetColumn[]>> = {
  overview: findingsColumns,
  queries: [
    column('query', 'Query pattern', '390px', 'Similar statements grouped together with literal values removed.', { monospace: true }),
    column('db', 'Database', '120px', 'The database that handled the statement.'),
    column('calls', 'Calls', '88px', 'How many times this query pattern ran in the selected range.', { align: 'right', format: 'number' }),
    column('db_time_ms', 'Database time', '124px', 'Total time MySQL spent on this query pattern. Start here.', { align: 'right', format: 'duration-ms' }),
    column('mean_ms', 'Average', '104px', 'Average time for one call.', { align: 'right', format: 'duration-ms' }),
    column('lock_ms', 'Lock time', '104px', 'Time spent waiting for locks.', { align: 'right', format: 'duration-ms' }),
    column('rows_examined', 'Rows read', '106px', 'Rows MySQL inspected to answer the query.', { align: 'right', format: 'number' }),
    column('rows_sent', 'Rows returned', '116px', 'Rows sent back to the client.', { align: 'right', format: 'number' }),
    column('no_index_calls', 'No-index calls', '120px', 'Calls where MySQL reported that it could not use an index.', { align: 'right', format: 'number' }),
  ],
  activity: [
    column('query', 'Current query', '390px', 'The normalized statement the connection is running or waiting on.', { monospace: true }),
    column('connection', 'Connection', '106px', 'The MySQL process list identifier.'),
    column('user', 'User', '120px', 'The MySQL account that opened the connection.'),
    column('db', 'Database', '120px', 'The selected database for this connection.'),
    column('state', 'State', '150px', 'What the connection is doing right now.'),
    column('age_s', 'Query age', '104px', 'How long the current statement has been running.', { align: 'right', format: 'duration-s' }),
    column('transaction_age_s', 'Transaction age', '124px', 'How long the surrounding transaction has been open.', { align: 'right', format: 'duration-s' }),
  ],
  waits: [
    column('wait_event', 'Wait', '360px', 'The resource or operation MySQL waited for.', { monospace: true }),
    column('category', 'Type', '150px', 'A broader group such as file I/O, locks, or synchronization.'),
    column('total_ms', 'Time spent', '124px', 'Total wait time in the selected range.', { align: 'right', format: 'duration-ms' }),
    column('count', 'Occurrences', '112px', 'How many waits MySQL recorded.', { align: 'right', format: 'number' }),
  ],
  locks: [
    column('waiting', 'Waiting connection', '142px', 'The connection that cannot continue.'),
    column('blocking', 'Blocking connection', '148px', 'The connection currently holding the needed lock.'),
    column('object', 'Table', '190px', 'The database object involved in the lock.', { monospace: true }),
    column('index', 'Index', '170px', 'The index involved, when MySQL reports one.', { monospace: true }),
    column('lock', 'Requested lock', '150px', 'The lock mode the waiting connection needs.'),
    column('waiting_query', 'Waiting query', '350px', 'The statement that is blocked.', { monospace: true }),
    column('blocking_query', 'Blocking query', '350px', 'The statement holding the lock.', { monospace: true }),
  ],
  tables: [
    column('table', 'Table', '220px', 'Database and table name.', { monospace: true }),
    column('engine', 'Engine', '100px', 'The MySQL storage engine.'),
    column('rows', 'Estimated rows', '120px', 'MySQL table statistics estimate, not an exact count.', { align: 'right', format: 'number' }),
    column('data_bytes', 'Table data', '112px', 'Space used by table data.', { align: 'right', format: 'bytes' }),
    column('index_bytes', 'Indexes', '106px', 'Space used by this table’s indexes.', { align: 'right', format: 'bytes' }),
    column('reads', 'Reads', '92px', 'Recorded table read operations.', { align: 'right', format: 'number' }),
    column('writes', 'Writes', '92px', 'Recorded table write operations.', { align: 'right', format: 'number' }),
    column('io_ms', 'I/O time', '106px', 'Time spent on table I/O.', { align: 'right', format: 'duration-ms' }),
  ],
  indexes: [
    column('severity', 'Priority', '88px', 'Warning items deserve review. Observed rows are usage evidence.'),
    column('table', 'Table', '210px', 'Database and table that own the index.', { monospace: true }),
    column('index', 'Index', '190px', 'The index name.', { monospace: true }),
    column('columns', 'Columns', '230px', 'Columns covered by the index, in order.', { monospace: true }),
    column('reads', 'Reads', '88px', 'Recorded reads that used this index.', { align: 'right', format: 'number' }),
    column('writes', 'Writes', '88px', 'Recorded writes that maintained this index.', { align: 'right', format: 'number' }),
    column('finding', 'What Rush found', '260px', 'Why this index is worth reviewing.'),
    column('next_step', 'What to do', '360px', 'A safe next step. Verify a full workload cycle before dropping an index.'),
  ],
  replication: [
    column('channel', 'Channel', '140px', 'The configured replication channel.'),
    column('state', 'State', '110px', 'Whether the I/O and SQL replication threads are running.'),
    column('lag_s', 'Lag', '100px', 'Reported delay behind the source.', { align: 'right', format: 'duration-s' }),
    column('source', 'Source', '190px', 'The source host for this channel.'),
    column('io_error', 'I/O error', '110px', 'The latest receiver error number. Zero means none.'),
    column('sql_error', 'SQL error', '110px', 'The latest apply error number. Zero means none.'),
    column('observed', 'Observed', '170px', 'When this state or error was observed.'),
  ],
  advisor: findingsColumns,
  errors: [
    column('time', 'Time', '190px', 'When MySQL wrote the event.'),
    column('priority', 'Priority', '100px', 'MySQL error log priority.'),
    column('code', 'Code', '110px', 'The MySQL error code.', { monospace: true }),
    column('subsystem', 'Subsystem', '150px', 'The MySQL component that emitted the event.'),
    column('message', 'Message', '440px', 'Error text when collection of message text is enabled.'),
    column('text_included', 'Text collected', '124px', 'Whether this row includes the original error message.', { format: 'boolean' }),
  ],
}

export const MYSQL_VIEW_META: Record<MySqlView, MySqlViewMeta> = {
  overview: {
    eyebrow: 'Start here',
    title: 'MySQL health',
    description: 'Current pressure, recent work, and settings worth reviewing.',
    guide: 'Handle blocked work first. Then check database time for expensive query patterns. Settings findings are review items, not automatic changes.',
    terms: [
      { term: 'Blocked', meaning: 'A transaction is waiting for another transaction to release a lock.' },
      { term: 'Database time', meaning: 'All time MySQL spent running a group of similar statements.' },
      { term: 'Purge backlog', meaning: 'Old row versions InnoDB still needs to clean up.' },
    ],
    events: ['mysql.advisor'],
  },
  queries: {
    eyebrow: 'Workload',
    title: 'Expensive query patterns',
    description: 'Similar statements are grouped together and ranked by total database time.',
    guide: 'Start with database time, not average latency. A fast query that runs thousands of times can consume more capacity than one slow query.',
    terms: [
      { term: 'Query pattern', meaning: 'A statement with literal values removed so similar calls group together.' },
      { term: 'Rows read', meaning: 'Rows MySQL inspected. A large gap versus rows returned can point to wasted work.' },
      { term: 'No-index call', meaning: 'MySQL reported that a call could not use an index.' },
    ],
    events: ['mysql.query_stats'],
  },
  activity: {
    eyebrow: 'Right now',
    title: 'Active database work',
    description: 'Connections executing a statement or waiting for MySQL.',
    guide: 'Look for old queries and old transactions. A quiet connection can still hold locks when its transaction stays open.',
    terms: [
      { term: 'Query age', meaning: 'Time spent on the statement running now.' },
      { term: 'Transaction age', meaning: 'Time since the transaction began, including time between statements.' },
    ],
    events: ['mysql.activity'],
  },
  waits: {
    eyebrow: 'Where time goes',
    title: 'Database wait time',
    description: 'Resources and operations that made MySQL pause.',
    guide: 'High wait time is useful only with context. Compare it with query throughput, then open Queries or Locks for the work causing it.',
    terms: [
      { term: 'Wait time', meaning: 'Time MySQL could not make progress because it needed a resource.' },
      { term: 'Occurrences', meaning: 'How often MySQL recorded that wait.' },
    ],
    events: ['mysql.wait_stats'],
  },
  locks: {
    eyebrow: 'Contention',
    title: 'Blocked work',
    description: 'The waiting connection, the blocker, and the statements involved.',
    guide: 'The waiting query is the symptom. Inspect the blocking connection before stopping anything, because it may own a valid long-running transaction.',
    terms: [
      { term: 'Waiting', meaning: 'The connection that cannot continue.' },
      { term: 'Blocking', meaning: 'The connection holding the lock that is needed.' },
    ],
    events: ['mysql.lock_wait', 'mysql.metadata_lock_wait'],
  },
  tables: {
    eyebrow: 'Storage',
    title: 'Table use',
    description: 'Size and read, write, and I/O activity for application tables.',
    guide: 'Use size to find growth risk. Use reads, writes, and I/O time to find hot tables. Row counts are MySQL estimates.',
    terms: [
      { term: 'Estimated rows', meaning: 'A planning estimate from MySQL statistics, not SELECT COUNT(*).' },
      { term: 'I/O time', meaning: 'Time spent reading or writing table files.' },
    ],
    events: ['mysql.schema.table'],
  },
  indexes: {
    eyebrow: 'Query paths',
    title: 'Index use and findings',
    description: 'Which indexes serve reads and which ones deserve review.',
    guide: 'Unused does not mean safe to delete. Observe a full business cycle, check foreign keys and query plans, then remove only proven waste.',
    terms: [
      { term: 'Unused', meaning: 'No reads recorded since Performance Schema counters were reset.' },
      { term: 'Redundant', meaning: 'Another index starts with the same columns and may cover it.' },
    ],
    events: ['mysql.schema.index', 'mysql.advisor'],
  },
  replication: {
    eyebrow: 'Availability',
    title: 'Replica health',
    description: 'Thread state, delay, source, and the latest worker errors.',
    guide: 'A stopped thread or non-zero error needs review. Lag matters when it grows over time or breaks your recovery and read-freshness goals.',
    terms: [
      { term: 'I/O thread', meaning: 'Receives changes from the source.' },
      { term: 'SQL thread', meaning: 'Applies received changes on the replica.' },
      { term: 'Lag', meaning: 'Reported delay between the replica and its source.' },
    ],
    events: ['mysql.replication', 'mysql.replication_error'],
  },
  capacity: {
    eyebrow: 'Limits',
    title: 'Capacity and growth',
    description: 'Connection headroom, stored data, and pressure on InnoDB.',
    guide: 'Watch trends, not one sample. Connection use near the configured limit and sustained storage growth need action before they become incidents.',
    terms: [
      { term: 'Connection use', meaning: 'Open client sessions compared with max_connections.' },
      { term: 'Purge backlog', meaning: 'Old row versions InnoDB still needs to clean up.' },
    ],
    events: [],
  },
  advisor: {
    eyebrow: 'Review queue',
    title: 'Recommended checks',
    description: 'Observed settings and conditions with a safe next step.',
    guide: 'Treat these as review items. Confirm the evidence against your workload and change process. Rush never applies a database setting.',
    terms: [
      { term: 'Warning', meaning: 'A condition with a plausible operational or security impact.' },
      { term: 'Info', meaning: 'Context worth checking during planned maintenance.' },
    ],
    events: ['mysql.advisor', 'mysql.setting'],
  },
  errors: {
    eyebrow: 'Server events',
    title: 'MySQL error log',
    description: 'Structured server events grouped by time, priority, and subsystem.',
    guide: 'Start with error and system priorities. Use the error code to find the MySQL cause when message collection is disabled.',
    terms: [
      { term: 'Subsystem', meaning: 'The MySQL component that wrote the event.' },
      { term: 'Text collected', meaning: 'Whether Rush stored the original message. It is off by default.' },
    ],
    events: ['mysql.error'],
  },
}

const SYSTEM_SCHEMAS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys'])
const numberAttr = (attrs: Record<string, string>, key: string) => Number(attrs[key] || 0)
const schemaFor = (row: LogRecord) => row.LogAttributes.db || row.LogAttributes.schema || ''
const isApplicationRow = (row: LogRecord) => !SYSTEM_SCHEMAS.has(schemaFor(row).toLowerCase())

function isCollectorStatement(row: LogRecord): boolean {
  const statement = row.Body.toLowerCase()
  return statement.includes('performance_schema')
    || statement.includes('information_schema')
    || statement.includes('`sys` .')
    || statement.includes('from sys.')
    || statement.startsWith('show global ')
    || statement.startsWith('show replica ')
    || statement.startsWith('select @@')
}

function friendlyName(value: string): string {
  const names: Record<string, string> = {
    auto_increment_capacity: 'Auto-increment capacity is running low',
    digest_text_truncation: 'Query patterns may be shortened',
    redundant_index: 'An index may be redundant',
    unencrypted_connections_allowed: 'TLS is not required',
    unused_index: 'An index has no recorded reads',
  }
  if (names[value]) return names[value]
  const text = value.replace(/_/g, ' ').trim()
  return text ? text[0]!.toUpperCase() + text.slice(1) : 'Review this condition'
}

function severity(value: string): string {
  const normalized = value.toLowerCase()
  if (['critical', 'danger', 'error'].includes(normalized)) return 'danger'
  if (normalized === 'warning' || normalized === 'warn') return 'warning'
  return 'info'
}

function newestBy(rows: LogRecord[], key: (row: LogRecord) => string): LogRecord[] {
  const seen = new Set<string>()
  return [...rows]
    .sort((a, b) => b.Timestamp - a.Timestamp)
    .filter((row) => {
      const value = key(row)
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
}

function currentSnapshot(rows: LogRecord[], windowMs = 2_000): LogRecord[] {
  const newest = rows.reduce((value, row) => Math.max(value, row.Timestamp), 0)
  if (!newest) return []
  const windowNs = windowMs * 1_000_000
  return rows.filter((row) => newest - row.Timestamp <= windowNs)
}

function currentLockSnapshot(rows: LogRecord[], nowMs: number): LogRecord[] {
  const recent = rows.filter((row) => nowMs * 1_000_000 - row.Timestamp <= 30_000_000_000)
  return currentSnapshot(recent, 5_000)
}

function findingRow(row: LogRecord): Record<string, unknown> {
  const attrs = row.LogAttributes
  if (attrs.setting) {
    return {
      severity: 'info',
      item: friendlyName(attrs.setting),
      current: attrs.value || '-',
      evidence: row.Body,
      next_step: attrs.recommendation || 'Compare this value with the workload before changing it.',
    }
  }
  return {
    severity: severity(attrs.severity || 'info'),
    item: friendlyName(attrs.check || 'notice'),
    current: attrs.current || '-',
    evidence: row.Body,
    next_step: attrs.recommendation || 'Review the evidence before making a change.',
  }
}

function queryRows(rows: LogRecord[]): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>>()
  for (const row of rows.filter((item) => isApplicationRow(item) && !isCollectorStatement(item))) {
    const attrs = row.LogAttributes
    const key = `${attrs.db || ''}\u0000${row.Body}`
    const current = groups.get(key) || {
      query: row.Body,
      db: attrs.db || '-',
      calls: 0,
      db_time_ms: 0,
      mean_ms: 0,
      lock_ms: 0,
      rows_examined: 0,
      rows_sent: 0,
      no_index_calls: 0,
    }
    current.calls = Number(current.calls) + numberAttr(attrs, 'calls')
    current.db_time_ms = Number(current.db_time_ms) + numberAttr(attrs, 'total_ms')
    current.lock_ms = Number(current.lock_ms) + numberAttr(attrs, 'lock_ms')
    current.rows_examined = Number(current.rows_examined) + numberAttr(attrs, 'rows_examined')
    current.rows_sent = Number(current.rows_sent) + numberAttr(attrs, 'rows_sent')
    current.no_index_calls = Number(current.no_index_calls) + numberAttr(attrs, 'no_index_used')
    current.mean_ms = Number(current.calls) > 0 ? Number(current.db_time_ms) / Number(current.calls) : 0
    groups.set(key, current)
  }
  return Array.from(groups.values()).sort((a, b) => Number(b.db_time_ms) - Number(a.db_time_ms))
}

function waitRows(rows: LogRecord[]): Record<string, unknown>[] {
  const groups = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const attrs = row.LogAttributes
    const key = `${attrs.category || 'other'}\u0000${attrs.wait_event || row.Body}`
    const current = groups.get(key) || {
      wait_event: attrs.wait_event || row.Body,
      category: attrs.category || 'other',
      total_ms: 0,
      count: 0,
    }
    current.total_ms = Number(current.total_ms) + numberAttr(attrs, 'total_ms')
    current.count = Number(current.count) + numberAttr(attrs, 'count')
    groups.set(key, current)
  }
  return Array.from(groups.values()).sort((a, b) => Number(b.total_ms) - Number(a.total_ms))
}

export function presentMySqlRows(view: MySqlView, rows: LogRecord[], nowMs = Date.now()): Record<string, unknown>[] {
  if (view === 'queries') return queryRows(rows)
  if (view === 'waits') return waitRows(rows)

  if (view === 'overview' || view === 'advisor') {
    const findings = newestBy(rows.filter((row) => {
      const check = row.LogAttributes.check || ''
      return check !== 'unused_index' || isApplicationRow(row)
    }), (row) => {
      const attrs = row.LogAttributes
      return attrs.setting || [attrs.check, attrs.db, attrs.table, attrs.index].join(':')
    }).map(findingRow)
    const priority = (value: unknown) => value === 'danger' ? 2 : value === 'warning' ? 1 : 0
    return findings.sort((a, b) => priority(b.severity) - priority(a.severity))
  }

  if (view === 'activity') {
    return newestBy(currentSnapshot(rows, 3_000), (row) => row.LogAttributes.pid || row.Body).map((row) => {
      const attrs = row.LogAttributes
      return {
        query: row.Body,
        connection: attrs.pid || '-',
        user: attrs.user || '-',
        db: attrs.db || '-',
        state: attrs.state || attrs.command || '-',
        age_s: numberAttr(attrs, 'age_s'),
        transaction_age_s: numberAttr(attrs, 'transaction_age_s'),
      }
    }).sort((a, b) => Number(b.transaction_age_s) - Number(a.transaction_age_s))
  }

  if (view === 'locks') {
    return newestBy(currentLockSnapshot(rows, nowMs), (row) => {
      const attrs = row.LogAttributes
      return [attrs.waiting_pid, attrs.blocking_pid, attrs.schema, attrs.table, attrs.index].join(':')
    }).map((row) => {
      const attrs = row.LogAttributes
      return {
        waiting: attrs.waiting_pid || attrs.waiting || '-',
        blocking: attrs.blocking_pid || '-',
        object: [attrs.schema, attrs.table].filter(Boolean).join('.') || row.Body,
        index: attrs.index || '-',
        lock: attrs.waiting_lock_mode || attrs.lock_type || '-',
        waiting_query: attrs.waiting_query || '-',
        blocking_query: attrs.blocking_query || '-',
      }
    })
  }

  if (view === 'tables') {
    return newestBy(currentSnapshot(rows.filter(isApplicationRow)), (row) => {
      const attrs = row.LogAttributes
      return `${attrs.db}.${attrs.table}`
    }).map((row) => {
      const attrs = row.LogAttributes
      return {
        table: `${attrs.db || ''}.${attrs.table || ''}`,
        engine: attrs.engine || '-',
        rows: numberAttr(attrs, 'estimated_rows'),
        data_bytes: numberAttr(attrs, 'data_bytes'),
        index_bytes: numberAttr(attrs, 'index_bytes'),
        reads: numberAttr(attrs, 'reads'),
        writes: numberAttr(attrs, 'writes'),
        io_ms: numberAttr(attrs, 'io_ms'),
      }
    }).sort((a, b) => Number(b.data_bytes) + Number(b.index_bytes) - Number(a.data_bytes) - Number(a.index_bytes))
  }

  if (view === 'indexes') {
    const indexChecks = new Set(['redundant_index', 'unused_index'])
    const indexRows = rows.filter((row) => {
      const check = row.LogAttributes.check || ''
      return isApplicationRow(row) && (!check || indexChecks.has(check))
    })
    return newestBy(currentSnapshot(indexRows, 3_000), (row) => {
      const attrs = row.LogAttributes
      return [attrs.event, attrs.check, attrs.db, attrs.table, attrs.index].join(':')
    }).map((row) => {
      const attrs = row.LogAttributes
      const isFinding = Boolean(attrs.check)
      return {
        severity: isFinding ? severity(attrs.severity || 'info') : 'observed',
        table: `${attrs.db || ''}.${attrs.table || ''}`,
        index: attrs.index || '-',
        columns: attrs.columns || '-',
        reads: numberAttr(attrs, 'reads'),
        writes: numberAttr(attrs, 'writes'),
        finding: isFinding ? friendlyName(attrs.check || '') : 'Usage recorded by Performance Schema',
        next_step: isFinding ? (attrs.recommendation || row.Body) : 'Use this evidence before changing the index.',
      }
    }).sort((a, b) => {
      const priority = (value: unknown) => value === 'danger' ? 2 : value === 'warning' ? 1 : 0
      return priority(b.severity) - priority(a.severity) || Number(b.reads) - Number(a.reads)
    })
  }

  if (view === 'replication') {
    return newestBy(currentSnapshot(rows, 5_000), (row) => row.LogAttributes.channel || 'default').map((row) => {
      const attrs = row.LogAttributes
      return {
        channel: attrs.channel || 'default',
        state: attrs.error_number ? 'error' : (attrs.io_running === 'true' && attrs.sql_running === 'true' ? 'running' : 'stopped'),
        lag_s: numberAttr(attrs, 'lag_seconds'),
        source: attrs.source_host || '-',
        io_error: attrs.last_io_error_number || '0',
        sql_error: attrs.last_sql_error_number || attrs.error_number || '0',
        observed: attrs.error_time || 'current',
      }
    })
  }

  if (view === 'errors') {
    return [...rows].sort((a, b) => b.Timestamp - a.Timestamp).map((row) => {
      const attrs = row.LogAttributes
      return {
        time: attrs.logged_at || new Date(row.Timestamp / 1_000_000).toISOString(),
        priority: attrs.priority || '-',
        code: attrs.error_code || '-',
        subsystem: attrs.subsystem || '-',
        message: row.Body,
        text_included: attrs.message_included || 'false',
      }
    })
  }

  return []
}
