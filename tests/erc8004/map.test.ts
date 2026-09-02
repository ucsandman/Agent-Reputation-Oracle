import { describe, it, expect } from 'vitest';
import { mapFeedbackToEvent, normalizeConfidence, feedbackSourceKey, erc8004AgentId, withUriUpdate } from '../../src/erc8004/map.js';
import { ReputationEventSchema } from '../../src/models/event.js';
import type { Erc8004Feedback } from '../../src/erc8004/map.js';

// Shape and values taken from a real Base mainnet NewFeedback log
// (tx 0x8880a2dc45cc9c8ebd21dab96e401c103e84ec30175e8aaa1332a2e5c854ed9f, block 50747928).
const baseLog: Erc8004Feedback = {
  txHash: '0x8880a2dc45cc9c8ebd21dab96e401c103e84ec30175e8aaa1332a2e5c854ed9f',
  logIndex: 348,
  blockTimestamp: 1788285203,
  identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  agentTokenId: 25975n,
  ownerAddress: '0x69747C4Ce6185d21A33b3BcdBa980d659600aC7b',
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
      mapFeedbackToEvent(8453, { ...baseLog, clientAddress: baseLog.ownerAddress })
    ).toBeNull();
    // Same address, different casing, still self-feedback.
    expect(
      mapFeedbackToEvent(8453, { ...baseLog, clientAddress: baseLog.ownerAddress.toLowerCase() })
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
    expect(event.agentId).toBe(erc8004AgentId(8453, baseLog.identityRegistry, 25975n));
    expect(event.sourceAgentId).toBe('0x7cf8286c9B476DE7c262D086E2861FECefd3810b');
    expect(event.timestamp).toBe('2026-09-01T17:53:23.000Z');
    expect(event.data).toMatchObject({ type: 'attestation', category: 'reliability', confidence: 1 });
    expect(event.data).toHaveProperty('comment', expect.stringContaining('miner-vouch'));
    expect(event.proof.signature).toBe(baseLog.txHash);
    expect(event.proof.signer).toBe(event.sourceAgentId);
    expect(event.proof.domain).toBe('erc8004:8453');
    expect(event.proof.typedDataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('keys the agent on the token, so the id survives an owner key rotation', () => {
    const before = mapFeedbackToEvent(8453, baseLog)!;
    const after = mapFeedbackToEvent(8453, {
      ...baseLog,
      ownerAddress: '0x000000000000000000000000000000000000dEaD',
      logIndex: 349,
    })!;
    expect(after.agentId).toBe(before.agentId);
    expect(before.agentId).not.toBe(baseLog.ownerAddress);

    // Different token, chain, or registry is a different agent.
    expect(erc8004AgentId(8453, baseLog.identityRegistry, 25976n)).not.toBe(before.agentId);
    expect(erc8004AgentId(84532, baseLog.identityRegistry, 25975n)).not.toBe(before.agentId);
    expect(erc8004AgentId(8453, baseLog.identityRegistry.toLowerCase(), 25975n)).toBe(before.agentId);
  });

  it('checksums lowercase addresses coming off the chain', () => {
    const event = mapFeedbackToEvent(8453, {
      ...baseLog,
      clientAddress: baseLog.clientAddress.toLowerCase(),
    })!;
    expect(event.agentId).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(event.sourceAgentId).toBe(baseLog.clientAddress);
  });

  it('omits the comment when the log carries no tags or URI', () => {
    const event = mapFeedbackToEvent(8453, {
      txHash: baseLog.txHash,
      logIndex: 1,
      blockTimestamp: baseLog.blockTimestamp,
      identityRegistry: baseLog.identityRegistry,
      agentTokenId: baseLog.agentTokenId,
      ownerAddress: baseLog.ownerAddress,
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

describe('withUriUpdate', () => {
  const base = { chainId: 8453, identityRegistry: baseLog.identityRegistry, tokenId: '55867' };
  // Shape from a real Base mainnet URIUpdated log (tx 0xce2cff91..., block 50690598).
  const update = {
    txHash: '0xce2cff91bba619a6fd76374d3363d807143508a2e75919d8fd221c83e992ae27' as const,
    logIndex: 3,
    blockNumber: 50690598,
    timestamp: '2026-08-31T10:02:20.000Z',
    updatedBy: '0x164AfDf1FEE71A07057e1d7086e1B10590F3b250' as const,
    newURI: 'data:application/json;base64,eyJuYW1lIjoiSmF5biBCbGFxIn0=',
  };

  it('appends, dedupes on tx+logIndex, and keeps chain order', () => {
    const once = withUriUpdate(base, update);
    const twice = withUriUpdate(once, update);
    expect(twice).toBe(once);
    const earlier = { ...update, txHash: '0xaa' as const, logIndex: 0, blockNumber: 50000000 };
    const both = withUriUpdate(twice, earlier)['uriUpdates'] as { blockNumber: number }[];
    expect(both.map((u) => u.blockNumber)).toEqual([50000000, 50690598]);
    expect(once['tokenId']).toBe('55867');
  });
});
