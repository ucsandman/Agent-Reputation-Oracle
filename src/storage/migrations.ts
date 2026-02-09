import type Database from 'better-sqlite3';

const SCHEMA_VERSION = 1;

const MIGRATIONS: string[] = [
  // Version 1: Initial schema
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    previous_addresses TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN (
      'transaction_completed', 'sla_verified', 'arbitration_result', 'slash', 'attestation'
    )),
    timestamp TEXT NOT NULL,
    data TEXT NOT NULL,
    proof TEXT NOT NULL,
    source_agent_id TEXT NOT NULL,
    x402_transaction_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_events_agent_id ON events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_agent_type ON events(agent_id, event_type);

  CREATE TABLE IF NOT EXISTS reputation_cache (
    agent_id TEXT PRIMARY KEY,
    reliability_score REAL NOT NULL,
    completion_rate REAL NOT NULL,
    dispute_rate REAL NOT NULL,
    sla_adherence REAL NOT NULL,
    volume_weight REAL NOT NULL,
    total_events INTEGER NOT NULL,
    last_event_timestamp TEXT,
    last_computed_at TEXT NOT NULL,
    vector_hash TEXT NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY
  );

  INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION});
  `,
];

export function runMigrations(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    const migration = MIGRATIONS[i];
    if (!migration) continue;
    db.exec(migration);
  }
}

function getCurrentVersion(db: Database.Database): number {
  try {
    const row = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}
