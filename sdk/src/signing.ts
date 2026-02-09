import {
  verifyTypedData,
  keccak256,
  toHex,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { v4 as uuidv4 } from 'uuid';
import type {
  EvmAddress,
  ReputationEvent,
  ReputationEventData,
  ReputationEventType,
  ReputationVector,
  SignedReceipt,
} from './types.js';

// ─── EIP-712 Domain ───

export function getOracleDomain(chainId: number = 84532) {
  return {
    name: 'AgentReputationOracle' as const,
    version: '1' as const,
    chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000' as EvmAddress,
  };
}

// ─── EIP-712 Type Definitions (mirrors server) ───

export const REPUTATION_EVENT_TYPES = {
  ReputationEvent: [
    { name: 'id', type: 'string' },
    { name: 'agentId', type: 'address' },
    { name: 'eventType', type: 'string' },
    { name: 'timestamp', type: 'string' },
    { name: 'dataHash', type: 'bytes32' },
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

// ─── Hash Functions ───

export function hashEventData(data: ReputationEventData): Hex {
  const serialized = JSON.stringify(data);
  return keccak256(toHex(serialized));
}

export function hashReputationVector(vector: ReputationVector): Hex {
  const serialized = JSON.stringify(vector);
  return keccak256(toHex(serialized));
}

// ─── Event Signing ───

export interface CreateSignedEventParams {
  privateKey: `0x${string}`;
  agentId: EvmAddress;
  eventType: ReputationEventType;
  data: ReputationEventData;
  chainId?: number;
}

export async function createSignedEvent(
  params: CreateSignedEventParams,
): Promise<ReputationEvent> {
  const { privateKey, agentId, data, chainId = 84532 } = params;
  const eventType = data.type;

  const account = privateKeyToAccount(privateKey);
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const dataHash = hashEventData(data);
  const domain = getOracleDomain(chainId);

  const message = {
    id,
    agentId,
    eventType,
    timestamp,
    dataHash,
  };

  const signature = await account.signTypedData({
    domain,
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message,
  });

  return {
    id,
    agentId,
    eventType,
    timestamp,
    data,
    proof: {
      signature,
      signer: account.address,
      domain: `eip155:${chainId}`,
      typedDataHash: dataHash,
    },
    sourceAgentId: account.address,
  };
}

// ─── Receipt Verification ───

export async function verifyReceipt(
  receipt: SignedReceipt,
  chainId: number = 84532,
): Promise<boolean> {
  // Verify vector hash integrity (detect tampered vector payload)
  const computedHash = hashReputationVector(receipt.vector);
  if (computedHash !== receipt.vectorHash) {
    return false;
  }

  const message = {
    agentId: receipt.agentId,
    vectorHash: receipt.vectorHash,
    timestamp: receipt.timestamp,
    totalEvents: BigInt(receipt.vector.totalEvents),
  };

  const valid = await verifyTypedData({
    address: receipt.oracleAddress,
    domain: getOracleDomain(chainId),
    types: RECEIPT_TYPES,
    primaryType: 'ReputationReceipt',
    message,
    signature: receipt.signature,
  });

  return valid;
}
