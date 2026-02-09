import { describe, it, expect } from 'vitest';
import {
  computeReliability,
  computeCompletionRate,
  computeDisputeRate,
  computeSlaAdherence,
  computeVolumeWeight,
} from '../../src/reputation/math.js';
import type { ReputationEvent, EvmAddress } from '../../src/types/index.js';

const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';
const SOURCE_AGENT_ID: EvmAddress = '0x2222222222222222222222222222222222222222';
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
      signer: SOURCE_AGENT_ID,
      domain: 'AgentReputationOracle',
      typedDataHash: '0xbeef' as `0x${string}`,
    },
    sourceAgentId: overrides.sourceAgentId ?? SOURCE_AGENT_ID,
    ...overrides,
  };
}

describe('math scoring functions', () => {
  describe('computeReliability', () => {
    it('returns prior default (0.5) with 0 events', () => {
      const score = computeReliability([], NOW);
      expect(score).toBeCloseTo(0.5, 5);
    });

    it('increases toward 1.0 with positive events', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const score = computeReliability(events, NOW);
      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('decreases toward 0.0 with negative events', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'slash',
            severity: 'critical',
            reason: 'fraud',
            slasher: '0x3333333333333333333333333333333333333333' as EvmAddress,
          },
        }),
      );
      const score = computeReliability(events, NOW);
      expect(score).toBeLessThan(0.5);
    });

    it('considers arbitration outcomes', () => {
      const favoredEvents = Array.from({ length: 10 }, () =>
        makeEvent({
          data: {
            type: 'arbitration_result',
            outcome: 'agent_favored',
            valueUsd: 500,
            arbitrator: '0x4444444444444444444444444444444444444444' as EvmAddress,
          },
        }),
      );
      const unfavoredEvents = Array.from({ length: 10 }, () =>
        makeEvent({
          data: {
            type: 'arbitration_result',
            outcome: 'counterparty_favored',
            valueUsd: 500,
            arbitrator: '0x4444444444444444444444444444444444444444' as EvmAddress,
          },
        }),
      );

      const favoredScore = computeReliability(favoredEvents, NOW);
      const unfavoredScore = computeReliability(unfavoredEvents, NOW);
      expect(favoredScore).toBeGreaterThan(unfavoredScore);
    });
  });

  describe('computeCompletionRate', () => {
    it('returns prior default (0.7) with 0 events', () => {
      const score = computeCompletionRate([], NOW);
      expect(score).toBeCloseTo(0.7, 5);
    });

    it('increases toward 1.0 with successful completions', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const score = computeCompletionRate(events, NOW);
      expect(score).toBeGreaterThan(0.7);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('decreases toward 0.0 with failed completions', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: false,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const score = computeCompletionRate(events, NOW);
      expect(score).toBeLessThan(0.7);
    });

    it('ignores non-transaction events', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'sla_verified',
            metSla: true,
            slaType: 'latency',
            measuredValue: 100,
            threshold: 200,
          },
        }),
      );
      const score = computeCompletionRate(events, NOW);
      // Should return prior since no transaction_completed events
      expect(score).toBeCloseTo(0.7, 5);
    });
  });

  describe('computeDisputeRate', () => {
    it('returns prior default (0.05) with 0 events', () => {
      const score = computeDisputeRate([], NOW);
      expect(score).toBeCloseTo(0.05, 5);
    });

    it('increases with arbitration events (disputes)', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'arbitration_result',
            outcome: 'counterparty_favored',
            valueUsd: 500,
            arbitrator: '0x4444444444444444444444444444444444444444' as EvmAddress,
          },
        }),
      );
      const score = computeDisputeRate(events, NOW);
      expect(score).toBeGreaterThan(0.05);
    });

    it('decreases toward 0.0 with only completed transactions (no disputes)', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const score = computeDisputeRate(events, NOW);
      expect(score).toBeLessThan(0.05);
    });
  });

  describe('computeSlaAdherence', () => {
    it('returns prior default (0.8) with 0 events', () => {
      const score = computeSlaAdherence([], NOW);
      expect(score).toBeCloseTo(0.8, 5);
    });

    it('increases toward 1.0 when SLA consistently met', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'sla_verified',
            metSla: true,
            slaType: 'latency',
            measuredValue: 100,
            threshold: 200,
          },
        }),
      );
      const score = computeSlaAdherence(events, NOW);
      expect(score).toBeGreaterThan(0.8);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('decreases toward 0.0 when SLA consistently missed', () => {
      const events = Array.from({ length: 20 }, () =>
        makeEvent({
          data: {
            type: 'sla_verified',
            metSla: false,
            slaType: 'latency',
            measuredValue: 300,
            threshold: 200,
          },
        }),
      );
      const score = computeSlaAdherence(events, NOW);
      expect(score).toBeLessThan(0.8);
    });
  });

  describe('computeVolumeWeight', () => {
    it('returns 0 (ln(1+0)=0) with 0 events', () => {
      const weight = computeVolumeWeight([], NOW);
      expect(weight).toBe(0);
    });

    it('returns ln(1+N) for N recent events', () => {
      const n = 10;
      const events = Array.from({ length: n }, () =>
        makeEvent({
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
        }),
      );
      const weight = computeVolumeWeight(events, NOW);
      // Each event at t=0 has weight 1.0, so sum = N
      expect(weight).toBeCloseTo(Math.log(1 + n), 5);
    });

    it('grows sublinearly', () => {
      const makeNEvents = (n: number) =>
        Array.from({ length: n }, () =>
          makeEvent({
            data: {
              type: 'transaction_completed',
              completedSuccessfully: true,
              valueUsd: 100,
              durationMs: 5000,
            },
          }),
        );

      const weight10 = computeVolumeWeight(makeNEvents(10), NOW);
      const weight100 = computeVolumeWeight(makeNEvents(100), NOW);

      // 100 events should not give 10x the weight of 10 events
      expect(weight100 / weight10).toBeLessThan(10);
    });
  });
});
