import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import {
  getOracleDomain,
  hashEventData,
  hashReputationVector,
  createSignedEvent,
  verifyReceipt,
  REPUTATION_EVENT_TYPES,
  RECEIPT_TYPES,
} from '../src/signing.js';
import type {
  ReputationVector,
  SignedReceipt,
  TransactionCompletedData,
  AttestationData,
} from '../src/types.js';

// Hardhat test keys
const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ORACLE_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const ORACLE_ACCOUNT = privateKeyToAccount(ORACLE_PRIVATE_KEY);

describe('getOracleDomain', () => {
  it('returns domain with default chain ID', () => {
    const domain = getOracleDomain();
    expect(domain.name).toBe('AgentReputationOracle');
    expect(domain.version).toBe('1');
    expect(domain.chainId).toBe(84532);
    expect(domain.verifyingContract).toBe(
      '0x0000000000000000000000000000000000000000',
    );
  });

  it('returns domain with custom chain ID', () => {
    const domain = getOracleDomain(1);
    expect(domain.chainId).toBe(1);
  });

  it('returns domain with Sepolia chain ID', () => {
    const domain = getOracleDomain(11155111);
    expect(domain.chainId).toBe(11155111);
  });
});

describe('hashEventData', () => {
  it('produces consistent hash for same data', () => {
    const data: TransactionCompletedData = {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 100,
      durationMs: 5000,
    };
    const hash1 = hashEventData(data);
    const hash2 = hashEventData(data);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different data', () => {
    const data1: TransactionCompletedData = {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 100,
      durationMs: 5000,
    };
    const data2: TransactionCompletedData = {
      type: 'transaction_completed',
      completedSuccessfully: false,
      valueUsd: 100,
      durationMs: 5000,
    };
    expect(hashEventData(data1)).not.toBe(hashEventData(data2));
  });

  it('returns a valid hex string', () => {
    const data: AttestationData = {
      type: 'attestation',
      category: 'reliability',
      confidence: 0.9,
    };
    const hash = hashEventData(data);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('hashReputationVector', () => {
  it('produces consistent hash', () => {
    const vector: ReputationVector = {
      reliabilityScore: 0.95,
      completionRate: 0.9,
      disputeRate: 0.02,
      slaAdherence: 0.88,
      volumeWeight: 0.7,
      totalEvents: 42,
      lastEventTimestamp: '2025-01-01T00:00:00.000Z',
      computedAt: '2025-01-01T00:00:00.000Z',
    };
    const hash1 = hashReputationVector(vector);
    const hash2 = hashReputationVector(vector);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('createSignedEvent', () => {
  it('creates a valid signed event', async () => {
    const data: TransactionCompletedData = {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 50,
      durationMs: 3000,
    };

    const agentId = '0x1234567890123456789012345678901234567890' as const;
    const event = await createSignedEvent({
      privateKey: TEST_PRIVATE_KEY,
      agentId,
      eventType: 'transaction_completed',
      data,
    });

    expect(event.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(event.agentId).toBe(agentId);
    expect(event.eventType).toBe('transaction_completed');
    expect(event.data).toEqual(data);
    expect(event.proof.signer).toBe(TEST_ACCOUNT.address);
    expect(event.proof.signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(event.proof.domain).toBe('eip155:84532');
    expect(event.sourceAgentId).toBe(TEST_ACCOUNT.address);
  });

  it('produces a verifiable EIP-712 signature', async () => {
    const data: TransactionCompletedData = {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 100,
      durationMs: 5000,
    };

    const agentId = '0xabCDeF0123456789AbcdEf0123456789aBCDEF01' as const;
    const event = await createSignedEvent({
      privateKey: TEST_PRIVATE_KEY,
      agentId,
      eventType: 'transaction_completed',
      data,
      chainId: 84532,
    });

    const dataHash = hashEventData(data);
    const valid = await verifyTypedData({
      address: TEST_ACCOUNT.address,
      domain: getOracleDomain(84532),
      types: REPUTATION_EVENT_TYPES,
      primaryType: 'ReputationEvent',
      message: {
        id: event.id,
        agentId: event.agentId,
        eventType: event.eventType,
        timestamp: event.timestamp,
        dataHash,
      },
      signature: event.proof.signature,
    });

    expect(valid).toBe(true);
  });

  it('uses custom chain ID', async () => {
    const data: AttestationData = {
      type: 'attestation',
      category: 'quality',
      confidence: 0.85,
    };

    const agentId = '0x1234567890123456789012345678901234567890' as const;
    const event = await createSignedEvent({
      privateKey: TEST_PRIVATE_KEY,
      agentId,
      eventType: 'attestation',
      data,
      chainId: 1,
    });

    expect(event.proof.domain).toBe('eip155:1');
  });
});

describe('verifyReceipt', () => {
  async function createTestReceipt(chainId: number = 84532): Promise<SignedReceipt> {
    const vector: ReputationVector = {
      reliabilityScore: 0.95,
      completionRate: 0.9,
      disputeRate: 0.02,
      slaAdherence: 0.88,
      volumeWeight: 0.7,
      totalEvents: 42,
      lastEventTimestamp: '2025-01-01T00:00:00.000Z',
      computedAt: '2025-01-01T00:00:00.000Z',
    };

    const vectorHash = hashReputationVector(vector);
    const timestamp = new Date().toISOString();

    const message = {
      agentId: '0x1234567890123456789012345678901234567890' as const,
      vectorHash,
      timestamp,
      totalEvents: BigInt(vector.totalEvents),
    };

    const signature = await ORACLE_ACCOUNT.signTypedData({
      domain: getOracleDomain(chainId),
      types: RECEIPT_TYPES,
      primaryType: 'ReputationReceipt',
      message,
    });

    return {
      agentId: message.agentId,
      vector,
      vectorHash,
      signature,
      timestamp,
      oracleAddress: ORACLE_ACCOUNT.address,
    };
  }

  it('verifies a valid receipt', async () => {
    const receipt = await createTestReceipt();
    const valid = await verifyReceipt(receipt);
    expect(valid).toBe(true);
  });

  it('rejects a receipt with wrong chain ID', async () => {
    const receipt = await createTestReceipt(84532);
    const valid = await verifyReceipt(receipt, 1);
    expect(valid).toBe(false);
  });

  it('rejects a tampered receipt', async () => {
    const receipt = await createTestReceipt();
    receipt.vector.reliabilityScore = 0.1;
    const valid = await verifyReceipt(receipt);
    expect(valid).toBe(false);
  });

  it('rejects a receipt with wrong oracle address', async () => {
    const receipt = await createTestReceipt();
    receipt.oracleAddress = '0x0000000000000000000000000000000000000001';
    const valid = await verifyReceipt(receipt);
    expect(valid).toBe(false);
  });
});
