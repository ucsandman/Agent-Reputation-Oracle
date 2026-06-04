import { z } from 'zod';
import type { AppConfig, EvmAddress } from './types/index.js';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3402),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  X402_NETWORK: z.string().default('eip155:84532'),
  X402_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  X402_FACILITATOR_URL: z.string().url().default('https://facilitator.x402.org'),
  X402_SCHEME: z.string().default('exact'),
  X402_SYNC_ON_START: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

  PRICE_REPUTATION_QUERY: z.string().default('0.001'),
  PRICE_REPUTATION_SUMMARY: z.string().default('0.0005'),
  PRICE_ATTESTATION_QUERY: z.string().default('0.001'),
  PRICE_EVENT_SUBMIT: z.string().default('0.01'),

  DB_PATH: z.string().default('./data/reputation.db'),

  SERVER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),

  MAX_EVENTS_PER_AGENT_PER_HOUR: z.coerce.number().int().positive().default(100),
});

export function loadConfig(): AppConfig {
  const parsed = ConfigSchema.parse(process.env);

  return {
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    x402: {
      network: parsed.X402_NETWORK,
      payTo: parsed.X402_PAY_TO as EvmAddress,
      facilitatorUrl: parsed.X402_FACILITATOR_URL,
      scheme: parsed.X402_SCHEME,
      syncOnStart: parsed.X402_SYNC_ON_START,
    },
    pricing: {
      reputationQuery: parsed.PRICE_REPUTATION_QUERY,
      reputationSummary: parsed.PRICE_REPUTATION_SUMMARY,
      attestationQuery: parsed.PRICE_ATTESTATION_QUERY,
      eventSubmit: parsed.PRICE_EVENT_SUBMIT,
    },
    db: {
      path: parsed.DB_PATH,
    },
    server: {
      privateKey: parsed.SERVER_PRIVATE_KEY as `0x${string}`,
    },
    security: {
      maxEventsPerAgentPerHour: parsed.MAX_EVENTS_PER_AGENT_PER_HOUR,
    },
  };
}
