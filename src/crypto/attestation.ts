import { verifyTypedData, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { EvmAddress } from '../types/index.js';
import { REPUTATION_ORACLE_DOMAIN } from './signing.js';

// ─── EIP-712 Attestation Type ───

export const ATTESTATION_TYPES = {
  EventAcceptance: [
    { name: 'eventId', type: 'string' },
    { name: 'agentId', type: 'address' },
    { name: 'timestamp', type: 'string' },
  ],
} as const;

// ─── Attestation Shape ───

export interface EventAcceptanceAttestation {
  signature: Hex;
  signer: EvmAddress;
  eventId: string;
  agentId: EvmAddress;
  timestamp: string;
}

// ─── AttestationService ───

export class AttestationService {
  private readonly account;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
  }

  get oracleAddress(): EvmAddress {
    return this.account.address;
  }

  async createEventAcceptanceAttestation(
    eventId: string,
    agentId: EvmAddress,
  ): Promise<EventAcceptanceAttestation> {
    const timestamp = new Date().toISOString();

    const message = {
      eventId,
      agentId,
      timestamp,
    };

    const signature = await this.account.signTypedData({
      domain: REPUTATION_ORACLE_DOMAIN,
      types: ATTESTATION_TYPES,
      primaryType: 'EventAcceptance',
      message,
    });

    return {
      signature,
      signer: this.account.address,
      eventId,
      agentId,
      timestamp,
    };
  }

  async verifyAttestation(
    attestation: EventAcceptanceAttestation,
  ): Promise<boolean> {
    const message = {
      eventId: attestation.eventId,
      agentId: attestation.agentId,
      timestamp: attestation.timestamp,
    };

    const valid = await verifyTypedData({
      address: attestation.signer,
      domain: REPUTATION_ORACLE_DOMAIN,
      types: ATTESTATION_TYPES,
      primaryType: 'EventAcceptance',
      message,
      signature: attestation.signature,
    });

    return valid;
  }
}
