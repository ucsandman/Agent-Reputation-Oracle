import { verifyTypedData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  EvmAddress,
  ReputationVector,
  SignedReceipt,
} from '../types/index.js';
import {
  REPUTATION_ORACLE_DOMAIN,
  RECEIPT_TYPES,
  hashReputationVector,
} from './signing.js';

// ─── ReceiptService ───

export class ReceiptService {
  private readonly account;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  get oracleAddress(): EvmAddress {
    return this.account.address;
  }

  async signReputationReceipt(
    agentId: EvmAddress,
    vector: ReputationVector,
  ): Promise<SignedReceipt> {
    const vectorHash = hashReputationVector(vector);
    const timestamp = new Date().toISOString();

    const message = {
      agentId,
      vectorHash,
      timestamp,
      totalEvents: BigInt(vector.totalEvents),
    };

    const signature = await this.account.signTypedData({
      domain: REPUTATION_ORACLE_DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: 'ReputationReceipt',
      message,
    });

    return {
      agentId,
      vector,
      vectorHash,
      signature,
      timestamp,
      oracleAddress: this.account.address,
    };
  }

  async verifyReceipt(receipt: SignedReceipt): Promise<boolean> {
    const message = {
      agentId: receipt.agentId,
      vectorHash: receipt.vectorHash,
      timestamp: receipt.timestamp,
      totalEvents: BigInt(receipt.vector.totalEvents),
    };

    const valid = await verifyTypedData({
      address: receipt.oracleAddress,
      domain: REPUTATION_ORACLE_DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: 'ReputationReceipt',
      message,
      signature: receipt.signature,
    });

    return valid;
  }
}
