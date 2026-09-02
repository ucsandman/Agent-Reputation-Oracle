import Database from 'better-sqlite3';
import { runMigrations } from './migrations.js';
import type {
  ReputationEvent,
  Agent,
  EvmAddress,
  EventQueryOptions,
} from '../types/index.js';

export class EventLog {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    runMigrations(this.db);
  }

  appendEvent(event: ReputationEvent): boolean {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (id, agent_id, event_type, timestamp, data, proof, source_agent_id, x402_transaction_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      event.id,
      event.agentId,
      event.eventType,
      event.timestamp,
      JSON.stringify(event.data),
      JSON.stringify(event.proof),
      event.sourceAgentId,
      event.x402TransactionHash ?? null,
    );

    return result.changes > 0;
  }

  getEventsByAgent(agentId: EvmAddress, options?: EventQueryOptions): ReputationEvent[] {
    let sql = 'SELECT * FROM events WHERE agent_id = ?';
    const params: unknown[] = [agentId];

    if (options?.eventType) {
      sql += ' AND event_type = ?';
      params.push(options.eventType);
    }
    if (options?.since) {
      sql += ' AND timestamp >= ?';
      params.push(options.since);
    }
    if (options?.until) {
      sql += ' AND timestamp <= ?';
      params.push(options.until);
    }

    sql += ' ORDER BY timestamp ASC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as EventRow[];
    return rows.map(rowToEvent);
  }

  getEventById(id: string): ReputationEvent | null {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  countEventsByAgentSince(agentId: EvmAddress, since: string): number {
    // created_at is SQLite datetime('now') format ('YYYY-MM-DD HH:MM:SS'); normalize ISO input to match.
    const sqliteSince = since.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND created_at >= ?'
    ).get(agentId, sqliteSince) as { count: number };
    return row.count;
  }

  /** Events whose own timestamp is after `afterIso` (ISO strings compare lexically); all events when undefined. */
  countEventsByAgentAfter(agentId: EvmAddress, afterIso?: string): number {
    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND timestamp > ?'
    ).get(agentId, afterIso ?? '') as { count: number };
    return row.count;
  }

  ensureAgent(agentId: EvmAddress, metadata?: Record<string, unknown>): void {
    if (metadata) {
      this.db.prepare(`
        INSERT INTO agents (id, metadata) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET metadata = excluded.metadata, updated_at = datetime('now')
      `).run(agentId, JSON.stringify(metadata));
      return;
    }
    this.db.prepare(`
      INSERT OR IGNORE INTO agents (id) VALUES (?)
    `).run(agentId);
  }

  getAgent(agentId: EvmAddress): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined;
    if (!row) return null;

    return {
      id: row.id as EvmAddress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      previousAddresses: JSON.parse(row.previous_addresses) as EvmAddress[],
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    };
  }

  rotateAgentKey(oldAddress: EvmAddress, newAddress: EvmAddress): void {
    const agent = this.getAgent(oldAddress);
    if (!agent) {
      throw new Error(`Agent ${oldAddress} not found`);
    }

    const previousAddresses = [...agent.previousAddresses, oldAddress];

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO agents (id, previous_addresses, metadata)
        VALUES (?, ?, ?)
      `).run(newAddress, JSON.stringify(previousAddresses), JSON.stringify(agent.metadata));

      this.db.prepare(`
        UPDATE agents SET updated_at = datetime('now') WHERE id = ?
      `).run(oldAddress);
    })();
  }

  /**
   * Append-order page of the whole log for external replay. `seq` is the SQLite rowid,
   * so a consumer can resume with `after = last seq` and never miss or repeat an event.
   */
  getEventsAfter(after: number, limit: number): Array<ReputationEvent & { seq: number }> {
    const rows = this.db.prepare(
      'SELECT rowid AS seq, * FROM events WHERE rowid > ? ORDER BY rowid ASC LIMIT ?'
    ).all(after, limit) as Array<EventRow & { seq: number }>;
    return rows.map((row) => ({ seq: row.seq, ...rowToEvent(row) }));
  }

  *getAllEvents(batchSize: number = 1000): Generator<ReputationEvent[]> {
    let offset = 0;
    while (true) {
      const rows = this.db.prepare(
        'SELECT * FROM events ORDER BY timestamp ASC LIMIT ? OFFSET ?'
      ).all(batchSize, offset) as EventRow[];

      if (rows.length === 0) break;

      yield rows.map(rowToEvent);
      offset += batchSize;

      if (rows.length < batchSize) break;
    }
  }

  getAttesterDistribution(agentId: EvmAddress): Map<string, number> {
    const rows = this.db.prepare(
      'SELECT source_agent_id, COUNT(*) as count FROM events WHERE agent_id = ? GROUP BY source_agent_id'
    ).all(agentId) as Array<{ source_agent_id: string; count: number }>;

    const distribution = new Map<string, number>();
    for (const row of rows) {
      distribution.set(row.source_agent_id, row.count);
    }
    return distribution;
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// ─── Row Types ───

interface EventRow {
  id: string;
  agent_id: string;
  event_type: string;
  timestamp: string;
  data: string;
  proof: string;
  source_agent_id: string;
  x402_transaction_hash: string | null;
  created_at: string;
}

interface AgentRow {
  id: string;
  created_at: string;
  updated_at: string;
  previous_addresses: string;
  metadata: string;
}

function rowToEvent(row: EventRow): ReputationEvent {
  return {
    id: row.id,
    agentId: row.agent_id as EvmAddress,
    eventType: row.event_type as ReputationEvent['eventType'],
    timestamp: row.timestamp,
    data: JSON.parse(row.data) as ReputationEvent['data'],
    proof: JSON.parse(row.proof) as ReputationEvent['proof'],
    sourceAgentId: row.source_agent_id as EvmAddress,
    x402TransactionHash: row.x402_transaction_hash ?? undefined,
  };
}
