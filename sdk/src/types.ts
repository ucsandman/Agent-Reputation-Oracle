// ─── Agent Identity ───

export type EvmAddress = `0x${string}`;

// ─── Reputation Vector ───

export interface ReputationVector {
  reliabilityScore: number;
  completionRate: number;
  disputeRate: number;
  slaAdherence: number;
  volumeWeight: number;
  totalEvents: number;
  lastEventTimestamp: string;
  computedAt: string;
  compositeScore: number;
}

// ─── Reputation Events ───

export type ReputationEventType =
  | 'transaction_completed'
  | 'sla_verified'
  | 'arbitration_result'
  | 'slash'
  | 'attestation';

export interface TransactionCompletedData {
  type: 'transaction_completed';
  completedSuccessfully: boolean;
  valueUsd: number;
  durationMs: number;
}

export interface SlaVerifiedData {
  type: 'sla_verified';
  metSla: boolean;
  slaType: string;
  measuredValue: number;
  threshold: number;
}

export interface ArbitrationResultData {
  type: 'arbitration_result';
  outcome: 'agent_favored' | 'counterparty_favored' | 'split';
  valueUsd: number;
  arbitrator: EvmAddress;
}

export interface SlashData {
  type: 'slash';
  severity: 'minor' | 'major' | 'critical';
  reason: string;
  slasher: EvmAddress;
}

export interface AttestationData {
  type: 'attestation';
  category: 'reliability' | 'quality' | 'speed' | 'communication';
  confidence: number;
  comment?: string;
}

export type ReputationEventData =
  | TransactionCompletedData
  | SlaVerifiedData
  | ArbitrationResultData
  | SlashData
  | AttestationData;

// ─── Event Proof (EIP-712) ───

export interface EventProof {
  signature: `0x${string}`;
  signer: EvmAddress;
  domain: string;
  typedDataHash: `0x${string}`;
}

// ─── Reputation Event ───

export interface ReputationEvent {
  id: string;
  agentId: EvmAddress;
  eventType: ReputationEventType;
  timestamp: string;
  data: ReputationEventData;
  proof: EventProof;
  sourceAgentId: EvmAddress;
  x402TransactionHash?: string;
}

// ─── Signed Receipt ───

export interface SignedReceipt {
  agentId: EvmAddress;
  vector: ReputationVector;
  vectorHash: `0x${string}`;
  signature: `0x${string}`;
  timestamp: string;
  oracleAddress: EvmAddress;
}

// ─── Reputation Summary ───

export interface ReputationSummary {
  agentId: EvmAddress;
  reliabilityScore: number;
  completionRate: number;
  disputeRate: number;
  slaAdherence: number;
  volumeWeight: number;
  compositeScore: number;
  totalEvents: number;
  isActive: boolean;
  confidence: number;
  lastEventTimestamp: string;
  computedAt: string;
}

// ─── API Response Types ───

export interface ReputationResponse {
  agentId: EvmAddress;
  vector: ReputationVector;
  receipt: SignedReceipt;
}

export interface EventSubmissionResponse {
  accepted: boolean;
  eventId: string;
  attestation: {
    signature: `0x${string}`;
    signer: EvmAddress;
    eventId: string;
    agentId: EvmAddress;
    timestamp: string;
  };
  duplicate?: boolean;
}

// ─── Event Query Options ───

export interface EventQueryOptions {
  limit?: number;
  offset?: number;
  eventType?: ReputationEventType;
}

// ─── Attestations Response ───

export interface AttestationsResponse {
  agentId: EvmAddress;
  events: ReputationEvent[];
  pagination: {
    limit: number;
    offset: number;
    count: number;
  };
}

// ─── Health Response ───

export interface HealthResponse {
  status: string;
  oracle: EvmAddress;
  network: string;
  timestamp: string;
}

// ─── Client Config ───

export interface OracleClientConfig {
  /** Base URL of the oracle (e.g. "http://localhost:3402") */
  oracleUrl: string;
  /** Agent's private key for signing events (required for submitEvent) */
  privateKey?: `0x${string}`;
  /** Chain ID for EIP-712 domain. Default: 84532 (Base Sepolia) */
  chainId?: number;
  /** Custom fetch implementation (for testing or Node <18) */
  fetch?: typeof globalThis.fetch;
}
