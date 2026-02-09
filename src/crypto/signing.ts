import { verifyTypedData, keccak256, toHex, type Hex } from 'viem';
import type {
  ReputationEvent,
  ReputationVector,
  EvmAddress,
} from '../types/index.js';

// ─── EIP-712 Domain ───

let _chainId = 84532;

export function setChainId(chainId: number): void {
  _chainId = chainId;
}

export function getReputationOracleDomain() {
  return {
    name: 'AgentReputationOracle' as const,
    version: '1' as const,
    chainId: _chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000' as EvmAddress,
  };
}

/** @deprecated Use getReputationOracleDomain() for dynamic chainId. Kept for backward compat in tests. */
export const REPUTATION_ORACLE_DOMAIN = {
  name: 'AgentReputationOracle',
  version: '1',
  chainId: 84532,
  verifyingContract: '0x0000000000000000000000000000000000000000' as EvmAddress,
} as const;

// ─── EIP-712 Type Definitions ───

export const REPUTATION_EVENT_TYPES = {
  ReputationEvent: [
    { name: 'id', type: 'string' },
    { name: 'agentId', type: 'address' },
    { name: 'eventType', type: 'string' },
    { name: 'timestamp', type: 'string' },
    { name: 'dataHash', type: 'bytes32' },
  ],
} as const;

export const KEY_ROTATION_TYPES = {
  KeyRotation: [
    { name: 'oldAddress', type: 'address' },
    { name: 'newAddress', type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export const RECEIPT_TYPES = {
  ReputationReceipt: [
    { name: 'agentId', type: 'address' },
    { name: 'vectorHash', type: 'bytes32' },
    { name: 'timestamp', type: 'string' },
    { name: 'totalEvents', type: 'uint256' },
  ],
} as const;

// ─── Signing Utilities ───

export function hashEvent(event: ReputationEvent): Hex {
  const serialized = JSON.stringify(event.data);
  return keccak256(toHex(serialized));
}

export function hashReputationVector(vector: ReputationVector): Hex {
  const serialized = JSON.stringify(vector);
  return keccak256(toHex(serialized));
}

export async function verifyEventSignature(
  event: ReputationEvent,
): Promise<boolean> {
  const dataHash = hashEvent(event);

  const message = {
    id: event.id,
    agentId: event.agentId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    dataHash,
  };

  const valid = await verifyTypedData({
    address: event.proof.signer,
    domain: getReputationOracleDomain(),
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message,
    signature: event.proof.signature,
  });

  return valid;
}
