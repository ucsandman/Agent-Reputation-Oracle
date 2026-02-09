import { z } from 'zod';

const evmAddressRegex = /^0x[0-9a-fA-F]{40}$/;

const EvmAddressSchema = z.string().regex(evmAddressRegex, 'Invalid EVM address') as z.ZodType<`0x${string}`>;

const HexStringSchema = z.string().regex(/^0x[0-9a-fA-F]+$/, 'Invalid hex string') as z.ZodType<`0x${string}`>;

const IsoTimestampSchema = z.string().datetime({ message: 'Must be ISO 8601 timestamp' });

const UuidSchema = z.string().uuid('Must be UUID v4');

// ─── Event Data Schemas ───

const TransactionCompletedDataSchema = z.object({
  type: z.literal('transaction_completed'),
  completedSuccessfully: z.boolean(),
  valueUsd: z.number().nonnegative(),
  durationMs: z.number().int().nonnegative(),
});

const SlaVerifiedDataSchema = z.object({
  type: z.literal('sla_verified'),
  metSla: z.boolean(),
  slaType: z.string().min(1).max(100),
  measuredValue: z.number(),
  threshold: z.number(),
});

const ArbitrationResultDataSchema = z.object({
  type: z.literal('arbitration_result'),
  outcome: z.enum(['agent_favored', 'counterparty_favored', 'split']),
  valueUsd: z.number().nonnegative(),
  arbitrator: EvmAddressSchema,
});

const SlashDataSchema = z.object({
  type: z.literal('slash'),
  severity: z.enum(['minor', 'major', 'critical']),
  reason: z.string().min(1).max(500),
  slasher: EvmAddressSchema,
});

const AttestationDataSchema = z.object({
  type: z.literal('attestation'),
  category: z.enum(['reliability', 'quality', 'speed', 'communication']),
  confidence: z.number().min(0).max(1),
  comment: z.string().max(1000).optional(),
});

const ReputationEventDataSchema = z.discriminatedUnion('type', [
  TransactionCompletedDataSchema,
  SlaVerifiedDataSchema,
  ArbitrationResultDataSchema,
  SlashDataSchema,
  AttestationDataSchema,
]);

// ─── Event Proof Schema ───

const EventProofSchema = z.object({
  signature: HexStringSchema,
  signer: EvmAddressSchema,
  domain: z.string().min(1),
  typedDataHash: HexStringSchema,
});

// ─── Full Event Schema ───

export const ReputationEventSchema = z.object({
  id: UuidSchema,
  agentId: EvmAddressSchema,
  eventType: z.enum([
    'transaction_completed',
    'sla_verified',
    'arbitration_result',
    'slash',
    'attestation',
  ]),
  timestamp: IsoTimestampSchema,
  data: ReputationEventDataSchema,
  proof: EventProofSchema,
  sourceAgentId: EvmAddressSchema,
  x402TransactionHash: z.string().optional(),
});

export type ValidatedReputationEvent = z.infer<typeof ReputationEventSchema>;

// ─── Query Parameter Schemas ───

export const AttestationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum([
    'transaction_completed',
    'sla_verified',
    'arbitration_result',
    'slash',
    'attestation',
  ]).optional(),
});

export const AgentIdParamSchema = z.object({
  agentId: EvmAddressSchema,
});
