import { describe, it, expect } from 'vitest';
import { ReputationEngine } from '../../src/reputation/engine.js';
import type { ReputationEvent, EvmAddress } from '../../src/types/index.js';

const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';
const SOURCE_A: EvmAddress = '0x2222222222222222222222222222222222222222';
const SOURCE_B: EvmAddress = '0x3333333333333333333333333333333333333333';
const SOURCE_C: EvmAddress = '0x4444444444444444444444444444444444444444';
const NOW = new Date('2025-06-01T00:00:00.000Z');

function makeEvent(
  overrides: Partial<ReputationEvent> & { data: ReputationEvent['data'] },
): ReputationEvent {
  return {
    id: crypto.randomUUID(),
    agentId: AGENT_ID,
    eventType: overrides.data.type as ReputationEvent['eventType'],
    timestamp: overrides.timestamp ?? NOW.toISOString(),
    data: overrides.data,
    proof: {
      signature: '0xdead' as `0x${string}`,
      signer: overrides.sourceAgentId ?? SOURCE_A,
      domain: 'AgentReputationOracle',
      typedDataHash: '0xbeef' as `0x${string}`,
    },
    sourceAgentId: overrides.sourceAgentId ?? SOURCE_A,
    ...overrides,
  };
}

describe('ReputationEngine', () => {
  const engine = new ReputationEngine();

  describe('computeVector', () => {
    it('returns prior defaults for 0 events', () => {
      const vector = engine.computeVector([], NOW);
      expect(vector.reliabilityScore).toBeCloseTo(0.5, 5);
      expect(vector.completionRate).toBeCloseTo(0.7, 5);
      expect(vector.disputeRate).toBeCloseTo(0.05, 5);
      expect(vector.slaAdherence).toBeCloseTo(0.8, 5);
      expect(vector.volumeWeight).toBe(0);
      expect(vector.totalEvents).toBe(0);
      expect(vector.lastEventTimestamp).toBe('');
      expect(vector.computedAt).toBe(NOW.toISOString());
    });

    it('computes a full vector from mixed events', () => {
      const events: ReputationEvent[] = [
        makeEvent({
          sourceAgentId: SOURCE_A,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
        makeEvent({
          sourceAgentId: SOURCE_B,
          data: {
            type: 'sla_verified',
            metSla: true,
            slaType: 'latency',
            measuredValue: 100,
            threshold: 200,
          },
        }),
        makeEvent({
          sourceAgentId: SOURCE_C,
          data: {
            type: 'attestation',
            category: 'reliability',
            confidence: 0.9,
          },
        }),
      ];

      const vector = engine.computeVector(events, NOW);

      expect(vector.reliabilityScore).toBeGreaterThan(0.5);
      expect(vector.completionRate).toBeGreaterThan(0.7);
      expect(vector.slaAdherence).toBeGreaterThan(0.8);
      expect(vector.volumeWeight).toBeGreaterThan(0);
      expect(vector.totalEvents).toBe(3);
      expect(vector.lastEventTimestamp).toBe(NOW.toISOString());
    });

    it('is deterministic: same inputs + same now = identical output', () => {
      const events: ReputationEvent[] = [
        makeEvent({
          id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
          sourceAgentId: SOURCE_A,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
        makeEvent({
          id: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
          sourceAgentId: SOURCE_B,
          data: {
            type: 'sla_verified',
            metSla: false,
            slaType: 'throughput',
            measuredValue: 50,
            threshold: 100,
          },
        }),
      ];

      const vector1 = engine.computeVector(events, NOW);
      const vector2 = engine.computeVector(events, NOW);

      expect(vector1).toEqual(vector2);
    });
  });

  describe('collusion detection', () => {
    it('applies discount when single attester >50% of events', () => {
      // 6 events from SOURCE_A, 1 each from SOURCE_B and SOURCE_C
      // SOURCE_A has 6/8 = 75% > 50%
      const events: ReputationEvent[] = [
        ...Array.from({ length: 6 }, () =>
          makeEvent({
            sourceAgentId: SOURCE_A,
            data: {
              type: 'transaction_completed',
              completedSuccessfully: true,
              valueUsd: 100,
              durationMs: 5000,
            },
          }),
        ),
        makeEvent({
          sourceAgentId: SOURCE_B,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
        makeEvent({
          sourceAgentId: SOURCE_C,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      ];

      const colludedVector = engine.computeVector(events, NOW);

      // Make a balanced set: 3 from A, 3 from B, 2 from C -> max ratio = 3/8 = 37.5% < 50%
      const balancedEvents: ReputationEvent[] = [
        ...Array.from({ length: 3 }, () =>
          makeEvent({
            sourceAgentId: SOURCE_A,
            data: {
              type: 'transaction_completed',
              completedSuccessfully: true,
              valueUsd: 100,
              durationMs: 5000,
            },
          }),
        ),
        ...Array.from({ length: 3 }, () =>
          makeEvent({
            sourceAgentId: SOURCE_B,
            data: {
              type: 'transaction_completed',
              completedSuccessfully: true,
              valueUsd: 100,
              durationMs: 5000,
            },
          }),
        ),
        ...Array.from({ length: 2 }, () =>
          makeEvent({
            sourceAgentId: SOURCE_C,
            data: {
              type: 'transaction_completed',
              completedSuccessfully: true,
              valueUsd: 100,
              durationMs: 5000,
            },
          }),
        ),
      ];

      const balancedVector = engine.computeVector(balancedEvents, NOW);

      // With collusion discount (0.5), reliability is pulled toward 0.5 prior
      // balanced has no discount, so reliability moves further from prior
      // Both sets have all-true completions so raw reliability > 0.5
      // colluded should be closer to 0.5 than balanced
      expect(colludedVector.reliabilityScore).toBeLessThan(balancedVector.reliabilityScore);
    });
  });

  describe('attester weighting (sybil resistance)', () => {
    // What computeAttesterWeight returns for a wallet with no history of its own.
    const FRESH_WEIGHT = 0.1;

    it('gives a fresh wallet the floor weight and a strong attester much more', () => {
      const freshWeight = engine.computeAttesterWeight(engine.computeVector([], NOW));
      expect(freshWeight).toBeCloseTo(FRESH_WEIGHT, 5);

      const strongHistory = Array.from({ length: 200 }, (_, i) =>
        makeEvent({
          sourceAgentId: [SOURCE_A, SOURCE_B, SOURCE_C][i % 3]!,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const strongWeight = engine.computeAttesterWeight(engine.computeVector(strongHistory, NOW));
      expect(strongWeight).toBeGreaterThan(freshWeight * 2);
      expect(strongWeight).toBeLessThanOrEqual(1);
    });

    it('does not let 3 fresh wallets vouch an agent to a high score', () => {
      const sybils = [SOURCE_A, SOURCE_B, SOURCE_C];
      const events = Array.from({ length: 35 }, (_, i) =>
        makeEvent({
          sourceAgentId: sybils[i % 3]!,
          data: { type: 'attestation', category: 'reliability', confidence: 1.0 },
        }),
      );
      const weights = new Map<EvmAddress, number>(sybils.map((s) => [s, FRESH_WEIGHT]));

      const vector = engine.computeVector(events, NOW, weights);
      const summary = engine.computeSummary(AGENT_ID, vector);

      expect(vector.reliabilityScore).toBeLessThan(0.7);
      expect(summary.confidence).toBeLessThan(0.2);
    });

    it('still credits an honest agent vouched by one well-established attester', () => {
      const events = Array.from({ length: 100 }, () =>
        makeEvent({
          sourceAgentId: SOURCE_A,
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const weights = new Map<EvmAddress, number>([[SOURCE_A, 0.9]]);

      const vector = engine.computeVector(events, NOW, weights);

      expect(vector.reliabilityScore).toBeGreaterThan(0.75);
    });
  });

  describe('compositeScore', () => {
    it('sits near 50 for an agent with no events', () => {
      const vector = engine.computeVector([], NOW);
      expect(vector.compositeScore).toBeGreaterThan(45);
      expect(vector.compositeScore).toBeLessThan(55);
      expect(Number.isInteger(vector.compositeScore)).toBe(true);
    });
  });

  describe('computeSummary', () => {
    it('returns summary with isActive and confidence', () => {
      const vector = engine.computeVector([], NOW);
      const summary = engine.computeSummary(AGENT_ID, vector);

      expect(summary.agentId).toBe(AGENT_ID);
      expect(summary.reliabilityScore).toBe(vector.reliabilityScore);
      expect(summary.completionRate).toBe(vector.completionRate);
      expect(summary.disputeRate).toBe(vector.disputeRate);
      expect(summary.slaAdherence).toBe(vector.slaAdherence);
      expect(summary.volumeWeight).toBe(vector.volumeWeight);
      expect(summary.totalEvents).toBe(vector.totalEvents);
      expect(typeof summary.isActive).toBe('boolean');
      expect(typeof summary.confidence).toBe('number');
      expect(summary.confidence).toBeGreaterThanOrEqual(0);
      expect(summary.confidence).toBeLessThan(1);
    });

    it('has higher confidence with more events', () => {
      const emptyVector = engine.computeVector([], NOW);
      const events = Array.from({ length: 50 }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const fullVector = engine.computeVector(events, NOW);

      const emptySummary = engine.computeSummary(AGENT_ID, emptyVector);
      const fullSummary = engine.computeSummary(AGENT_ID, fullVector);

      expect(fullSummary.confidence).toBeGreaterThan(emptySummary.confidence);
    });

    it('isActive is false for 0 events (empty lastEventTimestamp)', () => {
      const vector = engine.computeVector([], NOW);
      const summary = engine.computeSummary(AGENT_ID, vector);
      expect(summary.isActive).toBe(false);
    });
  });
});
