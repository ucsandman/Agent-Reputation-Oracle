import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventLog } from '../../src/storage/event-log.js';
import { ReputationCache } from '../../src/storage/cache.js';
import type { ReputationVector, EvmAddress } from '../../src/types/index.js';

const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';

function makeVector(overrides?: Partial<ReputationVector>): ReputationVector {
  return {
    reliabilityScore: 0.85,
    completionRate: 0.92,
    disputeRate: 0.03,
    slaAdherence: 0.95,
    volumeWeight: 2.3,
    totalEvents: 10,
    lastEventTimestamp: '2025-06-01T00:00:00.000Z',
    computedAt: '2025-06-01T12:00:00.000Z',
    ...overrides,
  };
}

describe('ReputationCache', () => {
  let eventLog: EventLog;
  let cache: ReputationCache;

  beforeEach(() => {
    eventLog = new EventLog(':memory:');
    cache = new ReputationCache(eventLog.getDatabase());
  });

  afterEach(() => {
    eventLog.close();
  });

  describe('get', () => {
    it('returns null for unknown agent', () => {
      const result = cache.get(AGENT_ID);
      expect(result).toBeNull();
    });
  });

  describe('set then get', () => {
    it('round-trips a reputation vector', () => {
      eventLog.ensureAgent(AGENT_ID);

      const vector = makeVector();
      const vectorHash = '0xabcdef1234567890';

      cache.set(AGENT_ID, vector, vectorHash);
      const cached = cache.get(AGENT_ID);

      expect(cached).not.toBeNull();
      expect(cached!.agentId).toBe(AGENT_ID);
      expect(cached!.vector.reliabilityScore).toBeCloseTo(vector.reliabilityScore, 5);
      expect(cached!.vector.completionRate).toBeCloseTo(vector.completionRate, 5);
      expect(cached!.vector.disputeRate).toBeCloseTo(vector.disputeRate, 5);
      expect(cached!.vector.slaAdherence).toBeCloseTo(vector.slaAdherence, 5);
      expect(cached!.vector.volumeWeight).toBeCloseTo(vector.volumeWeight, 5);
      expect(cached!.vector.totalEvents).toBe(vector.totalEvents);
      expect(cached!.vector.lastEventTimestamp).toBe(vector.lastEventTimestamp);
      expect(cached!.vectorHash).toBe(vectorHash);
    });

    it('overwrites existing cache on second set', () => {
      eventLog.ensureAgent(AGENT_ID);

      const vector1 = makeVector({ reliabilityScore: 0.5 });
      cache.set(AGENT_ID, vector1, 'hash1');

      const vector2 = makeVector({ reliabilityScore: 0.9 });
      cache.set(AGENT_ID, vector2, 'hash2');

      const cached = cache.get(AGENT_ID);
      expect(cached!.vector.reliabilityScore).toBeCloseTo(0.9, 5);
      expect(cached!.vectorHash).toBe('hash2');
    });
  });

  describe('isStale', () => {
    it('returns true when no cache exists for agent', () => {
      expect(cache.isStale(AGENT_ID)).toBe(true);
    });

    it('returns false when cache exists and no new events', () => {
      eventLog.ensureAgent(AGENT_ID);

      const vector = makeVector();
      cache.set(AGENT_ID, vector, 'somehash');

      // No events added after cache was set, so not stale
      expect(cache.isStale(AGENT_ID)).toBe(false);
    });
  });

  describe('invalidate', () => {
    it('removes cache entry', () => {
      eventLog.ensureAgent(AGENT_ID);

      const vector = makeVector();
      cache.set(AGENT_ID, vector, 'somehash');
      expect(cache.get(AGENT_ID)).not.toBeNull();

      cache.invalidate(AGENT_ID);
      expect(cache.get(AGENT_ID)).toBeNull();
    });

    it('does not throw when invalidating non-existent entry', () => {
      expect(() => cache.invalidate(AGENT_ID)).not.toThrow();
    });
  });
});
