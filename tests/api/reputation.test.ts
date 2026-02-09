import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventLog } from '../../src/storage/event-log.js';
import { ReputationCache } from '../../src/storage/cache.js';
import { ReputationEngine } from '../../src/reputation/engine.js';
import { ReceiptService } from '../../src/crypto/receipt.js';
import { createReputationRouter } from '../../src/routes/reputation.js';
import type { EvmAddress, ReputationEvent } from '../../src/types/index.js';
import { v4 as uuidv4 } from 'uuid';

const ORACLE_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';
const SOURCE_AGENT_ID: EvmAddress = '0x2222222222222222222222222222222222222222';

function makeEvent(overrides?: Partial<ReputationEvent>): ReputationEvent {
  return {
    id: uuidv4(),
    agentId: AGENT_ID,
    eventType: 'transaction_completed',
    timestamp: new Date().toISOString(),
    data: {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 100,
      durationMs: 5000,
    },
    proof: {
      signature: '0xdead' as `0x${string}`,
      signer: SOURCE_AGENT_ID,
      domain: 'AgentReputationOracle',
      typedDataHash: '0xbeef' as `0x${string}`,
    },
    sourceAgentId: SOURCE_AGENT_ID,
    ...overrides,
  };
}

describe('reputation router', () => {
  let eventLog: EventLog;
  let cache: ReputationCache;
  let engine: ReputationEngine;
  let receiptService: ReceiptService;
  let app: express.Express;

  beforeEach(() => {
    eventLog = new EventLog(':memory:');
    cache = new ReputationCache(eventLog.getDatabase());
    engine = new ReputationEngine();
    receiptService = new ReceiptService(ORACLE_PRIVATE_KEY);

    app = express();
    app.use(express.json());
    app.use('/reputation', createReputationRouter(eventLog, cache, engine, receiptService));
  });

  afterEach(() => {
    eventLog.close();
  });

  describe('GET /:agentId', () => {
    it('returns 404 for unknown agent', async () => {
      const res = await request(app)
        .get(`/reputation/${AGENT_ID}`)
        .expect(404);

      expect(res.body.error).toBe('Agent not found');
    });

    it('returns vector and receipt for known agent with events', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent());

      const res = await request(app)
        .get(`/reputation/${AGENT_ID}`)
        .expect(200);

      expect(res.body.agentId).toBe(AGENT_ID);
      expect(res.body.vector).toBeDefined();
      expect(res.body.vector.reliabilityScore).toBeTypeOf('number');
      expect(res.body.vector.completionRate).toBeTypeOf('number');
      expect(res.body.vector.disputeRate).toBeTypeOf('number');
      expect(res.body.vector.slaAdherence).toBeTypeOf('number');
      expect(res.body.vector.volumeWeight).toBeTypeOf('number');
      expect(res.body.vector.totalEvents).toBe(1);
      expect(res.body.receipt).toBeDefined();
      expect(res.body.receipt.signature).toMatch(/^0x/);
      expect(res.body.receipt.oracleAddress).toBe(receiptService.oracleAddress);
    });

    it('returns 400 for invalid address', async () => {
      const res = await request(app)
        .get('/reputation/not-an-address')
        .expect(400);

      expect(res.body.error).toBe('Invalid EVM address');
    });
  });

  describe('GET /:agentId/summary', () => {
    it('returns 404 for unknown agent', async () => {
      const res = await request(app)
        .get(`/reputation/${AGENT_ID}/summary`)
        .expect(404);

      expect(res.body.error).toBe('Agent not found');
    });

    it('returns summary for known agent', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent());

      const res = await request(app)
        .get(`/reputation/${AGENT_ID}/summary`)
        .expect(200);

      expect(res.body.agentId).toBe(AGENT_ID);
      expect(res.body.reliabilityScore).toBeTypeOf('number');
      expect(res.body.completionRate).toBeTypeOf('number');
      expect(res.body.disputeRate).toBeTypeOf('number');
      expect(res.body.slaAdherence).toBeTypeOf('number');
      expect(typeof res.body.isActive).toBe('boolean');
      expect(typeof res.body.confidence).toBe('number');
    });
  });

  describe('GET /:agentId/attestations', () => {
    it('returns 404 for unknown agent', async () => {
      const res = await request(app)
        .get(`/reputation/${AGENT_ID}/attestations`)
        .expect(404);

      expect(res.body.error).toBe('Agent not found');
    });

    it('returns paginated events for known agent', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      for (let i = 0; i < 5; i++) {
        eventLog.appendEvent(makeEvent({ timestamp: `2025-01-0${i + 1}T00:00:00.000Z` }));
      }

      const res = await request(app)
        .get(`/reputation/${AGENT_ID}/attestations?limit=2&offset=0`)
        .expect(200);

      expect(res.body.agentId).toBe(AGENT_ID);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.pagination.limit).toBe(2);
      expect(res.body.pagination.offset).toBe(0);
      expect(res.body.pagination.count).toBe(2);
    });

    it('supports type filter', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);

      eventLog.appendEvent(makeEvent({
        eventType: 'transaction_completed',
        data: {
          type: 'transaction_completed',
          completedSuccessfully: true,
          valueUsd: 100,
          durationMs: 5000,
        },
      }));
      eventLog.appendEvent(makeEvent({
        eventType: 'sla_verified',
        data: {
          type: 'sla_verified',
          metSla: true,
          slaType: 'latency',
          measuredValue: 100,
          threshold: 200,
        },
      }));

      const res = await request(app)
        .get(`/reputation/${AGENT_ID}/attestations?type=sla_verified`)
        .expect(200);

      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].eventType).toBe('sla_verified');
    });
  });
});
