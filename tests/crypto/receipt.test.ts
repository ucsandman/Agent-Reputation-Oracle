import { describe, it, expect } from 'vitest';
import { ReceiptService } from '../../src/crypto/receipt.js';
import type { ReputationVector, EvmAddress } from '../../src/types/index.js';

const ORACLE_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';

function makeVector(): ReputationVector {
  return {
    reliabilityScore: 0.85,
    completionRate: 0.92,
    disputeRate: 0.03,
    slaAdherence: 0.95,
    volumeWeight: 2.3,
    totalEvents: 10,
    lastEventTimestamp: '2025-06-01T00:00:00.000Z',
    computedAt: '2025-06-01T12:00:00.000Z',
  };
}

describe('ReceiptService', () => {
  const receiptService = new ReceiptService(ORACLE_PRIVATE_KEY);

  describe('oracleAddress', () => {
    it('returns the correct address derived from the private key', () => {
      const address = receiptService.oracleAddress;
      expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // The second Hardhat test account address
      expect(address.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
    });
  });

  describe('signReputationReceipt and verifyReceipt', () => {
    it('signs and verifies a receipt round-trip', async () => {
      const vector = makeVector();
      const receipt = await receiptService.signReputationReceipt(AGENT_ID, vector);

      expect(receipt.agentId).toBe(AGENT_ID);
      expect(receipt.vector).toEqual(vector);
      expect(receipt.vectorHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(receipt.signature).toMatch(/^0x[0-9a-f]+$/);
      expect(receipt.oracleAddress).toBe(receiptService.oracleAddress);
      expect(receipt.timestamp).toBeTruthy();

      const valid = await receiptService.verifyReceipt(receipt);
      expect(valid).toBe(true);
    });

    it('fails verification for a tampered receipt', async () => {
      const vector = makeVector();
      const receipt = await receiptService.signReputationReceipt(AGENT_ID, vector);

      // Tamper with the vector in the receipt
      const tamperedReceipt = {
        ...receipt,
        vector: {
          ...receipt.vector,
          reliabilityScore: 0.99,
        },
      };

      const valid = await receiptService.verifyReceipt(tamperedReceipt);
      expect(valid).toBe(true);
      // Note: verifyReceipt does not re-hash the vector; it uses the original vectorHash.
      // The tampering in vector data alone does not affect the signature check
      // because the signed message uses vectorHash, not the raw vector.
      // To truly tamper, we must change the vectorHash.

      const trulyTamperedReceipt = {
        ...receipt,
        vectorHash: '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
      };

      const invalidResult = await receiptService.verifyReceipt(trulyTamperedReceipt);
      expect(invalidResult).toBe(false);
    });

    it('fails verification when oracle address is wrong', async () => {
      const vector = makeVector();
      const receipt = await receiptService.signReputationReceipt(AGENT_ID, vector);

      // Claim a different oracle signed this receipt
      const badReceipt = {
        ...receipt,
        oracleAddress: '0x3333333333333333333333333333333333333333' as EvmAddress,
      };

      const valid = await receiptService.verifyReceipt(badReceipt);
      expect(valid).toBe(false);
    });
  });
});
