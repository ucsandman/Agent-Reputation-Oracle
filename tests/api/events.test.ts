import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex } from 'viem';
import { v4 as uuidv4 } from 'uuid';
import { EventLog } from '../../src/storage/event-log.js';
import { ReputationCache } from '../../src/storage/cache.js';
import { AttestationService } from '../../src/crypto/attestation.js';
import { createEventsRouter } from '../../src/routes/events.js';
import {
  REPUTATION_ORACLE_DOMAIN,
  REPUTATION_EVENT_TYPES,
} from '../../src/crypto/signing.js';
import type { AppConfig, EvmAddress } from '../../src/types/index.js';

// Test keys (Hardhat default accounts)
const SOURCE_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ORACLE_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const sourceAccount = privateKeyToAccount(SOURCE_PRIVATE_KEY);
const SOURCE_AGENT_ID = sourceAccount.address as EvmAddress;

// A different agent to be the subject of attestations
const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';

const TEST_CONFIG: AppConfig = {
  port: 3000,
  nodeEnv: 'test',
  x402: {
    network: 'base-sepolia',
    payTo: '0x0000000000000000000000000000000000000000' as EvmAddress,
    facilitatorUrl: 'http://localhost:4021',
    scheme: 'exact',
    syncOnStart: false,
  },
  pricing: {
    reputationQuery: '0',
    reputationSummary: '0',
    attestationQuery: '0',
    eventSubmit: '0',
  },
  db: {
    path: ':memory:',
  },
  server: {
    privateKey: ORACLE_PRIVATE_KEY,
  },
  security: {
    maxEventsPerAgentPerHour: 100,
  },
};

async function createSignedEvent(overrides?: {
  agentId?: EvmAddress;
  sourceAgentId?: EvmAddress;
  id?: string;
  eventType?: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}) {
  const eventId = overrides?.id ?? uuidv4();
  const agentId = overrides?.agentId ?? AGENT_ID;
  const timestamp = overrides?.timestamp ?? new Date().toISOString();
  const eventType = overrides?.eventType ?? 'transaction_completed';

  const data = overrides?.data ?? {
    type: 'transaction_completed',
    completedSuccessfully: true,
    valueUsd: 100,
    durationMs: 5000,
  };

  const dataHash = keccak256(toHex(JSON.stringify(data)));

  const message = {
    id: eventId,
    agentId,
    eventType,
    timestamp,
    dataHash,
  };

  const signature = await sourceAccount.signTypedData({
    domain: REPUTATION_ORACLE_DOMAIN,
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message,
  });

  return {
    id: eventId,
    agentId,
    eventType,
    timestamp,
    data,
    proof: {
      signature,
      signer: SOURCE_AGENT_ID,
      domain: 'AgentReputationOracle',
      typedDataHash: dataHash,
    },
    sourceAgentId: overrides?.sourceAgentId ?? SOURCE_AGENT_ID,
  };
}

describe('events router', () => {
  let eventLog: EventLog;
  let cache: ReputationCache;
  let attestationService: AttestationService;
  let app: express.Express;

  beforeEach(() => {
    eventLog = new EventLog(':memory:');
    cache = new ReputationCache(eventLog.getDatabase());
    attestationService = new AttestationService(ORACLE_PRIVATE_KEY);

    app = express();
    app.use(express.json());
    app.use('/', createEventsRouter(eventLog, cache, attestationService, TEST_CONFIG));
  });

  afterEach(() => {
    eventLog.close();
  });

  describe('POST /', () => {
    it('returns 201 with valid signed event', async () => {
      const event = await createSignedEvent();

      const res = await request(app)
        .post('/')
        .send(event)
        .expect(201);

      expect(res.body.accepted).toBe(true);
      expect(res.body.eventId).toBe(event.id);
      expect(res.body.attestation).toBeDefined();
      expect(res.body.attestation.signature).toMatch(/^0x/);
      expect(res.body.attestation.signer).toBe(attestationService.oracleAddress);
    });

    it('returns 200 with duplicate: true for duplicate event', async () => {
      const event = await createSignedEvent();

      // First submission
      await request(app)
        .post('/')
        .send(event)
        .expect(201);

      // Duplicate submission
      const res = await request(app)
        .post('/')
        .send(event)
        .expect(200);

      expect(res.body.accepted).toBe(true);
      expect(res.body.duplicate).toBe(true);
    });

    it('returns 403 for self-attestation', async () => {
      // Create an event where agentId === sourceAgentId
      const selfEvent = await createSignedEvent({
        agentId: SOURCE_AGENT_ID,
        sourceAgentId: SOURCE_AGENT_ID,
      });

      const res = await request(app)
        .post('/')
        .send(selfEvent)
        .expect(403);

      expect(res.body.error).toBe('Self-attestation is not allowed');
    });

    it('returns 400 for invalid body (missing required fields)', async () => {
      const res = await request(app)
        .post('/')
        .send({ invalid: 'data' })
        .expect(400);

      expect(res.body.error).toBe('Invalid event data');
      expect(res.body.details).toBeDefined();
    });

    it('returns 400 when proof.signer does not match sourceAgentId', async () => {
      const event = await createSignedEvent();

      // Tamper with sourceAgentId to not match the signer
      const tamperedEvent = {
        ...event,
        sourceAgentId: '0x3333333333333333333333333333333333333333',
      };

      const res = await request(app)
        .post('/')
        .send(tamperedEvent)
        .expect(400);

      expect(res.body.error).toBe('Proof signer does not match sourceAgentId');
    });

    it('returns 400 for mismatched event signature (signed different data)', async () => {
      // Sign one event, but submit different data in the body
      const event = await createSignedEvent();

      // Tamper with the event data after signing (change valueUsd)
      const tamperedEvent = {
        ...event,
        data: {
          ...event.data,
          valueUsd: 999999,
        },
      };

      const res = await request(app)
        .post('/')
        .send(tamperedEvent)
        .expect(400);

      expect(res.body.error).toBe('Invalid event signature');
    });

    it('returns 400 for invalid UUID format', async () => {
      const event = await createSignedEvent({ id: 'not-a-uuid' });

      const res = await request(app)
        .post('/')
        .send(event)
        .expect(400);

      expect(res.body.error).toBe('Invalid event data');
    });

    it('returns 400 for invalid timestamp format', async () => {
      // We need to create a raw event body with a bad timestamp that bypasses signing
      const res = await request(app)
        .post('/')
        .send({
          id: uuidv4(),
          agentId: AGENT_ID,
          eventType: 'transaction_completed',
          timestamp: 'not-a-timestamp',
          data: {
            type: 'transaction_completed',
            completedSuccessfully: true,
            valueUsd: 100,
            durationMs: 5000,
          },
          proof: {
            signature: '0x' + 'ab'.repeat(65),
            signer: SOURCE_AGENT_ID,
            domain: 'AgentReputationOracle',
            typedDataHash: '0x' + 'ab'.repeat(32),
          },
          sourceAgentId: SOURCE_AGENT_ID,
        })
        .expect(400);

      expect(res.body.error).toBe('Invalid event data');
    });
  });
});
