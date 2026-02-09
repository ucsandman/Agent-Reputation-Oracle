import type Database from 'better-sqlite3';
import type { ReputationVector, EvmAddress, CachedReputation } from '../types/index.js';

export class ReputationCache {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  get(agentId: EvmAddress): CachedReputation | null {
    const row = this.db.prepare(
      'SELECT * FROM reputation_cache WHERE agent_id = ?'
    ).get(agentId) as CacheRow | undefined;

    if (!row) return null;

    return {
      agentId: row.agent_id as EvmAddress,
      vector: {
        reliabilityScore: row.reliability_score,
        completionRate: row.completion_rate,
        disputeRate: row.dispute_rate,
        slaAdherence: row.sla_adherence,
        volumeWeight: row.volume_weight,
        totalEvents: row.total_events,
        lastEventTimestamp: row.last_event_timestamp ?? '',
        computedAt: row.last_computed_at,
      },
      vectorHash: row.vector_hash,
      lastComputedAt: row.last_computed_at,
    };
  }

  set(agentId: EvmAddress, vector: ReputationVector, vectorHash: string): void {
    this.db.prepare(`
      INSERT INTO reputation_cache (agent_id, reliability_score, completion_rate, dispute_rate, sla_adherence, volume_weight, total_events, last_event_timestamp, last_computed_at, vector_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        reliability_score = excluded.reliability_score,
        completion_rate = excluded.completion_rate,
        dispute_rate = excluded.dispute_rate,
        sla_adherence = excluded.sla_adherence,
        volume_weight = excluded.volume_weight,
        total_events = excluded.total_events,
        last_event_timestamp = excluded.last_event_timestamp,
        last_computed_at = excluded.last_computed_at,
        vector_hash = excluded.vector_hash
    `).run(
      agentId,
      vector.reliabilityScore,
      vector.completionRate,
      vector.disputeRate,
      vector.slaAdherence,
      vector.volumeWeight,
      vector.totalEvents,
      vector.lastEventTimestamp || null,
      vector.computedAt,
      vectorHash,
    );
  }

  isStale(agentId: EvmAddress): boolean {
    const cached = this.get(agentId);
    if (!cached) return true;

    const row = this.db.prepare(
      'SELECT COUNT(*) as count FROM events WHERE agent_id = ? AND created_at > ?'
    ).get(agentId, cached.lastComputedAt) as { count: number };

    return row.count > 0;
  }

  invalidate(agentId: EvmAddress): void {
    this.db.prepare('DELETE FROM reputation_cache WHERE agent_id = ?').run(agentId);
  }
}

interface CacheRow {
  agent_id: string;
  reliability_score: number;
  completion_rate: number;
  dispute_rate: number;
  sla_adherence: number;
  volume_weight: number;
  total_events: number;
  last_event_timestamp: string | null;
  last_computed_at: string;
  vector_hash: string;
}
