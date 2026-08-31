import { describe, expect, it } from 'vitest'
import type { LogRecord } from '../../../types'
import { MYSQL_TABLE_COLUMNS, presentMySqlRows } from './mysqlPresentation'

function log(
  body: string,
  attributes: Record<string, string>,
  timestamp = 1_000_000_000,
): LogRecord {
  return {
    Timestamp: timestamp,
    TraceId: '',
    SpanId: '',
    SeverityText: '',
    SeverityNumber: 0,
    ServiceName: 'mysql-demo',
    Body: body,
    ResourceAttributes: {},
    ScopeName: 'mysql-collector',
    LogAttributes: attributes,
  }
}

describe('MySQL presentation', () => {
  it('groups query intervals and ranks patterns by total database time', () => {
    const rows = presentMySqlRows('queries', [
      log('SELECT * FROM orders WHERE id = ?', { db: 'shop', calls: '2', total_ms: '10', lock_ms: '1', rows_examined: '4', rows_sent: '2', no_index_used: '0' }),
      log('SELECT * FROM orders WHERE id = ?', { db: 'shop', calls: '3', total_ms: '30', lock_ms: '2', rows_examined: '6', rows_sent: '3', no_index_used: '1' }),
      log('SELECT * FROM performance_schema.threads', { db: 'performance_schema', calls: '99', total_ms: '999' }),
      log('SELECT * FROM `performance_schema` . `threads`', { db: 'shop', calls: '99', total_ms: '999' }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      db: 'shop',
      calls: 5,
      db_time_ms: 40,
      mean_ms: 8,
      lock_ms: 3,
      rows_examined: 10,
      rows_sent: 5,
      no_index_calls: 1,
    })
  })

  it('keeps one clear finding and removes internal-schema index noise', () => {
    const rows = presentMySqlRows('overview', [
      log('The index is covered by another index.', { check: 'redundant_index', severity: 'warning', db: 'shop', table: 'orders', index: 'orders_status', recommendation: 'Verify plans before removal.' }, 3_000_000_000),
      log('Older duplicate.', { check: 'redundant_index', severity: 'warning', db: 'shop', table: 'orders', index: 'orders_status' }, 2_000_000_000),
      log('Internal index.', { check: 'unused_index', severity: 'info', db: 'performance_schema', table: 'threads', index: 'NAME' }, 3_000_000_000),
    ])

    expect(rows).toEqual([expect.objectContaining({
      severity: 'warning',
      item: 'An index may be redundant',
      evidence: 'The index is covered by another index.',
      next_step: 'Verify plans before removal.',
    })])
  })

  it('keeps the indexes view focused on index evidence', () => {
    const rows = presentMySqlRows('indexes', [
      log('TLS is optional.', { event: 'mysql.advisor', check: 'unencrypted_connections_allowed', severity: 'warning', db: 'shop' }),
      log('Index is covered.', { event: 'mysql.advisor', check: 'redundant_index', severity: 'warning', db: 'shop', table: 'orders', index: 'orders_status' }),
      log('Index snapshot.', { event: 'mysql.schema.index', db: 'shop', table: 'orders', index: 'PRIMARY', columns: 'id', reads: '42' }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.index)).toEqual(expect.arrayContaining(['orders_status', 'PRIMARY']))
  })

  it('hides old lock events so historical contention is not shown as current', () => {
    const nowMs = 100_000
    const stale = log('old lock', { waiting_pid: '7', blocking_pid: '8' }, (nowMs - 31_000) * 1_000_000)
    const current = log('current lock', { waiting_pid: '9', blocking_pid: '10' }, (nowMs - 2_000) * 1_000_000)

    expect(presentMySqlRows('locks', [stale, current], nowMs)).toEqual([
      expect.objectContaining({ waiting: '9', blocking: '10' }),
    ])
  })

  it('defines stable, human-readable columns for every tabular view', () => {
    for (const view of ['overview', 'queries', 'activity', 'waits', 'locks', 'tables', 'indexes', 'replication', 'advisor', 'errors'] as const) {
      const columns = MYSQL_TABLE_COLUMNS[view]
      expect(columns?.length).toBeGreaterThan(0)
      expect(columns?.every((item) => item.label && item.width && item.description)).toBe(true)
    }
  })
})
