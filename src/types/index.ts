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

// ─── Agent Record ───

export interface Agent {
  id: EvmAddress;
  createdAt: string;
  updatedAt: string;
  previousAddresses: EvmAddress[];
  metadata: Record<string, unknown>;
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

// ─── Cached Reputation ───

export interface CachedReputation {
  agentId: EvmAddress;
  vector: ReputationVector;
  vectorHash: string;
  lastComputedAt: string;
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
  since?: string;
  until?: string;
}

// ─── Config Types ───

export interface AppConfig {
  port: number;
  nodeEnv: string;
  x402: {
    network: string;
    payTo: EvmAddress;
    facilitatorUrl: string;
    scheme: string;
    syncOnStart: boolean;
  };
  pricing: {
    reputationQuery: string;
    reputationSummary: string;
    attestationQuery: string;
    eventSubmit: string;
  };
  db: {
    path: string;
  };
  server: {
    privateKey: `0x${string}`;
  };
  security: {
    maxEventsPerAgentPerHour: number;
  };
}
