export { ReputationOracleClient } from './client.js';

export type {
  OracleClientConfig,
  EvmAddress,
  ReputationVector,
  ReputationSummary,
  SignedReceipt,
  ReputationEvent,
  ReputationEventData,
  ReputationEventType,
  TransactionCompletedData,
  SlaVerifiedData,
  ArbitrationResultData,
  SlashData,
  AttestationData,
  EventProof,
  ReputationResponse,
  EventSubmissionResponse,
  EventQueryOptions,
  AttestationsResponse,
  HealthResponse,
  EventsQueryOptions,
  EventsPage,
  AgentRecord,
} from './types.js';

export {
  OracleError,
  OracleHttpError,
  AgentNotFoundError,
  PaymentRequiredError,
  ValidationError,
  RateLimitError,
} from './errors.js';

export {
  verifyReceipt,
  createSignedEvent,
  hashEventData,
  hashReputationVector,
  getOracleDomain,
  REPUTATION_EVENT_TYPES,
  RECEIPT_TYPES,
} from './signing.js';

export type { CreateSignedEventParams } from './signing.js';
