import { getAddress, keccak256, toHex } from 'viem';
import { v5 as uuidv5 } from 'uuid';
import type { ReputationEvent, EvmAddress } from '../types/index.js';

/** Namespace for deterministic v5 event ids derived from on-chain feedback logs. */
const ERC8004_UUID_NAMESPACE = '8004a169-fb4a-4325-936e-b29fa0ceb6d2';

export interface Erc8004Feedback {
  txHash: `0x${string}`;
  logIndex: number;
  /** Unix seconds of the block containing the feedback log. */
  blockTimestamp: number;
  /** Identity Registry contract the agent token lives in. */
  identityRegistry: string;
  /** ERC-721 token id of the agent (`agentId` of the NewFeedback log). */
  agentTokenId: bigint;
  /** Current owner of the agent token (`ownerOf(agentId)`), used only to drop self-feedback. */
  ownerAddress: string;
  /** Feedback author (`clientAddress` of the NewFeedback log). */
  clientAddress: string;
  /** Signed fixed-point score (`value` of the NewFeedback log). */
  value: bigint;
  /** Decimal places for `value` (`valueDecimals`, 0-18). */
  valueDecimals: number;
  tag1?: string;
  tag2?: string;
  feedbackURI?: string;
}

/**
 * ERC-8004 leaves the scale of `value` up to the caller, so normalization is a heuristic:
 * raw = value / 10**valueDecimals, then raw <= 1 is a unit fraction (binary vouch, 0.85 rating)
 * and raw > 1 is a 0-100 scale (87 stars, 99.77% uptime). Both are clamped to [0, 1].
 * ponytail: two-branch heuristic; add a per-tag scale registry if a publisher uses another range.
 */
export function normalizeConfidence(value: bigint, valueDecimals: number): number {
  const raw = Number(value) / 10 ** valueDecimals;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw <= 1 ? raw : raw / 100, 1);
}

/**
 * Oracle agent id for an ERC-8004 agent: derived from the token, not its owner wallet,
 * so the identity survives the owner rotating keys or transferring the token.
 * Last 20 bytes of keccak256("erc8004:<chainId>:<registry>:<tokenId>"), checksummed.
 */
export function erc8004AgentId(chainId: number, identityRegistry: string, tokenId: bigint): EvmAddress {
  const hash = keccak256(toHex(`erc8004:${chainId}:${identityRegistry.toLowerCase()}:${tokenId}`));
  return getAddress(`0x${hash.slice(-40)}`) as EvmAddress;
}

/** Stable key for one on-chain feedback log; also the v5 name behind the event id. */
export function feedbackSourceKey(chainId: number, txHash: string, logIndex: number): string {
  return `erc8004:${chainId}:${txHash.toLowerCase()}:${logIndex}`;
}

/**
 * Maps one ERC-8004 NewFeedback log to an attestation event.
 * Returns null for self-feedback (client == agent owner), which carries no signal.
 */
export function mapFeedbackToEvent(chainId: number, log: Erc8004Feedback): ReputationEvent | null {
  const sourceAgentId = getAddress(log.clientAddress) as EvmAddress;
  if (getAddress(log.ownerAddress) === sourceAgentId) return null;
  const agentId = erc8004AgentId(chainId, log.identityRegistry, log.agentTokenId);

  const sourceKey = feedbackSourceKey(chainId, log.txHash, log.logIndex);
  const comment = [log.tag1, log.tag2, log.feedbackURI].filter(Boolean).join(' ').slice(0, 1000);

  return {
    id: uuidv5(sourceKey, ERC8004_UUID_NAMESPACE),
    agentId,
    eventType: 'attestation',
    timestamp: new Date(log.blockTimestamp * 1000).toISOString(),
    data: {
      type: 'attestation',
      category: 'reliability',
      confidence: normalizeConfidence(log.value, log.valueDecimals),
      ...(comment ? { comment } : {}),
    },
    proof: {
      // Provenance, not an EIP-712 signature: the chain is the witness.
      signature: log.txHash,
      signer: sourceAgentId,
      domain: `erc8004:${chainId}`,
      typedDataHash: keccak256(toHex(sourceKey)),
    },
    sourceAgentId,
  };
}
