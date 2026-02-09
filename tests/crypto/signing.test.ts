import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  hashEvent,
  hashReputationVector,
  verifyEventSignature,
  REPUTATION_ORACLE_DOMAIN,
  REPUTATION_EVENT_TYPES,
} from '../../src/crypto/signing.js';
import type { ReputationEvent, ReputationVector, EvmAddress } from '../../src/types/index.js';
import { keccak256, toHex } from 'viem';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';

describe('signing', () => {
  describe('hashEvent', () => {
    it('returns a consistent hash for the same event', () => {
      const event: ReputationEvent = {
        id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp: '2025-06-01T00:00:00.000Z',
        data: {
          type: 'transaction_completed',
          completedSuccessfully: true,
          valueUsd: 100,
          durationMs: 5000,
        },
        proof: {
          signature: '0xdead' as `0x${string}`,
          signer: '0x2222222222222222222222222222222222222222' as EvmAddress,
          domain: 'AgentReputationOracle',
          typedDataHash: '0xbeef' as `0x${string}`,
        },
        sourceAgentId: '0x2222222222222222222222222222222222222222' as EvmAddress,
      };

      const hash1 = hashEvent(event);
      const hash2 = hashEvent(event);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('returns different hashes for different event data', () => {
      const baseEvent: ReputationEvent = {
        id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp: '2025-06-01T00:00:00.000Z',
        data: {
          type: 'transaction_completed',
          completedSuccessfully: true,
          valueUsd: 100,
          durationMs: 5000,
        },
        proof: {
          signature: '0xdead' as `0x${string}`,
          signer: '0x2222222222222222222222222222222222222222' as EvmAddress,
          domain: 'AgentReputationOracle',
          typedDataHash: '0xbeef' as `0x${string}`,
        },
        sourceAgentId: '0x2222222222222222222222222222222222222222' as EvmAddress,
      };

      const modifiedEvent: ReputationEvent = {
        ...baseEvent,
        data: {
          type: 'transaction_completed',
          completedSuccessfully: false,
          valueUsd: 200,
          durationMs: 10000,
        },
      };

      expect(hashEvent(baseEvent)).not.toBe(hashEvent(modifiedEvent));
    });
  });

  describe('hashReputationVector', () => {
    it('returns a consistent hash for the same vector', () => {
      const vector: ReputationVector = {
        reliabilityScore: 0.85,
        completionRate: 0.92,
        disputeRate: 0.03,
        slaAdherence: 0.95,
        volumeWeight: 2.3,
        totalEvents: 10,
        lastEventTimestamp: '2025-06-01T00:00:00.000Z',
        computedAt: '2025-06-01T12:00:00.000Z',
      };

      const hash1 = hashReputationVector(vector);
      const hash2 = hashReputationVector(vector);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('returns different hashes for different vectors', () => {
      const vector1: ReputationVector = {
        reliabilityScore: 0.85,
        completionRate: 0.92,
        disputeRate: 0.03,
        slaAdherence: 0.95,
        volumeWeight: 2.3,
        totalEvents: 10,
        lastEventTimestamp: '2025-06-01T00:00:00.000Z',
        computedAt: '2025-06-01T12:00:00.000Z',
      };

      const vector2: ReputationVector = {
        ...vector1,
        reliabilityScore: 0.5,
      };

      expect(hashReputationVector(vector1)).not.toBe(hashReputationVector(vector2));
    });
  });

  describe('verifyEventSignature', () => {
    it('verifies a properly signed event', async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      const sourceAgentId = account.address as EvmAddress;

      const eventData = {
        type: 'transaction_completed' as const,
        completedSuccessfully: true,
        valueUsd: 100,
        durationMs: 5000,
      };

      const eventId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
      const timestamp = '2025-06-01T00:00:00.000Z';
      const dataHash = keccak256(toHex(JSON.stringify(eventData)));

      const message = {
        id: eventId,
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp,
        dataHash,
      };

      const signature = await account.signTypedData({
        domain: REPUTATION_ORACLE_DOMAIN,
        types: REPUTATION_EVENT_TYPES,
        primaryType: 'ReputationEvent',
        message,
      });

      const event: ReputationEvent = {
        id: eventId,
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp,
        data: eventData,
        proof: {
          signature,
          signer: sourceAgentId,
          domain: 'AgentReputationOracle',
          typedDataHash: dataHash,
        },
        sourceAgentId,
      };

      const valid = await verifyEventSignature(event);
      expect(valid).toBe(true);
    });

    it('rejects an event with wrong signer', async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);

      const eventData = {
        type: 'transaction_completed' as const,
        completedSuccessfully: true,
        valueUsd: 100,
        durationMs: 5000,
      };

      const eventId = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
      const timestamp = '2025-06-01T00:00:00.000Z';
      const dataHash = keccak256(toHex(JSON.stringify(eventData)));

      const message = {
        id: eventId,
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp,
        dataHash,
      };

      // Sign with the test account
      const signature = await account.signTypedData({
        domain: REPUTATION_ORACLE_DOMAIN,
        types: REPUTATION_EVENT_TYPES,
        primaryType: 'ReputationEvent',
        message,
      });

      // But claim a different signer address
      const wrongSigner: EvmAddress = '0x3333333333333333333333333333333333333333';

      const event: ReputationEvent = {
        id: eventId,
        agentId: AGENT_ID,
        eventType: 'transaction_completed',
        timestamp,
        data: eventData,
        proof: {
          signature,
          signer: wrongSigner,
          domain: 'AgentReputationOracle',
          typedDataHash: dataHash,
        },
        sourceAgentId: wrongSigner,
      };

      const valid = await verifyEventSignature(event);
      expect(valid).toBe(false);
    });
  });
});
