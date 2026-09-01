import { describe, it, expect } from 'vitest';
import { mapFeedbackToEvent, normalizeConfidence, feedbackSourceKey } from '../../src/erc8004/map.js';
import { ReputationEventSchema } from '../../src/models/event.js';
import type { Erc8004Feedback } from '../../src/erc8004/map.js';

// Shape and values taken from a real Base mainnet NewFeedback log
// (tx 0x8880a2dc45cc9c8ebd21dab96e401c103e84ec30175e8aaa1332a2e5c854ed9f, block 50747928).
const baseLog: Erc8004Feedback = {
  txHash: '0x8880a2dc45cc9c8ebd21dab96e401c103e84ec30175e8aaa1332a2e5c854ed9f',
  logIndex: 348,
  blockTimestamp: 1788285203,
  agentAddress: '0x69747C4Ce6185d21A33b3BcdBa980d659600aC7b',
  clientAddress: '0x7cf8286c9B476DE7c262D086E2861FECefd3810b',
  value: 1n,
  valueDecimals: 0,
  tag1: 'miner-vouch',
  tag2: 'botcoin',
  feedbackURI: 'https://coordinator.agentmoney.net/v1/miner/0x7cf/scorecard',
};

describe('normalizeConfidence', () => {
  it('treats raw values at or below 1 as unit fractions', () => {
    expect(normalizeConfidence(1n, 0)).toBe(1);
    expect(normalizeConfidence(85n, 2)).toBeCloseTo(0.85);
  });

  it('treats raw values above 1 as a 0-100 scale', () => {
    expect(normalizeConfidence(87n, 0)).toBeCloseTo(0.87);
    expect(normalizeConfidence(9977n, 2)).toBeCloseTo(0.9977);
  });

  it('clamps to [0, 1] for negative and out-of-range values', () => {
    expect(normalizeConfidence(-50n, 0)).toBe(0);
    expect(normalizeConfidence(0n, 0)).toBe(0);
    expect(normalizeConfidence(100000n, 0)).toBe(1);
  });
});

describe('mapFeedbackToEvent', () => {
  it('skips self-feedback', () => {
    expect(
      mapFeedbackToEvent(8453, { ...baseLog, clientAddress: baseLog.agentAddress })
    ).toBeNull();
    // Same address, different casing, still self-feedback.
    expect(
      mapFeedbackToEvent(8453, { ...baseLog, clientAddress: baseLog.agentAddress.toLowerCase() })
    ).toBeNull();
  });

  it('produces a deterministic id keyed on chain, tx and log index', () => {
    const a = mapFeedbackToEvent(8453, baseLog)!;
    const b = mapFeedbackToEvent(8453, { ...baseLog, value: 42n })!;
    expect(a.id).toBe(b.id);

    expect(mapFeedbackToEvent(8453, { ...baseLog, logIndex: 349 })!.id).not.toBe(a.id);
    expect(mapFeedbackToEvent(84532, baseLog)!.id).not.toBe(a.id);
    expect(feedbackSourceKey(8453, baseLog.txHash, 348)).toBe(
      `erc8004:8453:${baseLog.txHash}:348`
    );
  });

  it('maps feedback onto a reliability attestation with chain provenance', () => {
    const event = mapFeedbackToEvent(8453, baseLog)!;

    expect(event.eventType).toBe('attestation');
    expect(event.agentId).toBe('0x69747C4Ce6185d21A33b3BcdBa980d659600aC7b');
    expect(event.sourceAgentId).toBe('0x7cf8286c9B476DE7c262D086E2861FECefd3810b');
    expect(event.timestamp).toBe('2026-09-01T17:53:23.000Z');
    expect(event.data).toMatchObject({ type: 'attestation', category: 'reliability', confidence: 1 });
    expect(event.data).toHaveProperty('comment', expect.stringContaining('miner-vouch'));
    expect(event.proof.signature).toBe(baseLog.txHash);
    expect(event.proof.signer).toBe(event.sourceAgentId);
    expect(event.proof.domain).toBe('erc8004:8453');
    expect(event.proof.typedDataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('checksums lowercase addresses coming off the chain', () => {
    const event = mapFeedbackToEvent(8453, {
      ...baseLog,
      agentAddress: baseLog.agentAddress.toLowerCase(),
      clientAddress: baseLog.clientAddress.toLowerCase(),
    })!;
    expect(event.agentId).toBe(baseLog.agentAddress);
    expect(event.sourceAgentId).toBe(baseLog.clientAddress);
  });

  it('omits the comment when the log carries no tags or URI', () => {
    const event = mapFeedbackToEvent(8453, {
      txHash: baseLog.txHash,
      logIndex: 1,
      blockTimestamp: baseLog.blockTimestamp,
      agentAddress: baseLog.agentAddress,
      clientAddress: baseLog.clientAddress,
      value: 87n,
      valueDecimals: 0,
    })!;
    expect(event.data).not.toHaveProperty('comment');
    expect(ReputationEventSchema.safeParse(event).success).toBe(true);
  });

  it('produces an event accepted by ReputationEventSchema', () => {
    const result = ReputationEventSchema.safeParse(mapFeedbackToEvent(8453, baseLog));
    expect(result.error?.issues).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
