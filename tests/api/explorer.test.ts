import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { EventLog } from '../../src/storage/event-log.js';
import { ReputationCache } from '../../src/storage/cache.js';
import { ReputationEngine } from '../../src/reputation/engine.js';
import { createExplorerRouter } from '../../src/routes/explorer.js';
import type { EvmAddress, ReputationEvent } from '../../src/types/index.js';
import { v4 as uuidv4 } from 'uuid';

const AGENT_ID: EvmAddress = '0x1111111111111111111111111111111111111111';
const AGENT_ID_2: EvmAddress = '0x3333333333333333333333333333333333333333';
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

describe('explorer router', () => {
  let eventLog: EventLog;
  let cache: ReputationCache;
  let engine: ReputationEngine;
  let app: express.Express;

  beforeEach(() => {
    eventLog = new EventLog(':memory:');
    cache = new ReputationCache(eventLog.getDatabase());
    engine = new ReputationEngine();

    app = express();
    app.use('/explorer', createExplorerRouter(eventLog, cache, engine));
  });

  afterEach(() => {
    eventLog.close();
  });

  describe('GET /explorer', () => {
    it('returns 200 html listing seeded addresses', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(AGENT_ID_2);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent());
      eventLog.appendEvent(makeEvent({ id: uuidv4(), agentId: AGENT_ID_2 }));

      const res = await request(app).get('/explorer').expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain(AGENT_ID);
      expect(res.text).toContain(AGENT_ID_2);
    });
  });

  describe('GET /explorer/:agentId', () => {
    it('returns 200 html with address and dimension labels', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent());

      const res = await request(app).get(`/explorer/${AGENT_ID}`).expect(200);

      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain(AGENT_ID);
      expect(res.text).toContain('Reliability');
      expect(res.text).toContain('Completion');
      expect(res.text).toContain('Dispute');
      expect(res.text).toContain('SLA');
      expect(res.text).toContain('Volume');
    });

    it('returns 400 for invalid address', async () => {
      await request(app).get('/explorer/not-an-address').expect(400);
    });

    it('returns 404 for unknown agent', async () => {
      await request(app)
        .get('/explorer/0x9999999999999999999999999999999999999999')
        .expect(404);
    });

    it('escapes a script tag in an attestation comment', async () => {
      eventLog.ensureAgent(AGENT_ID);
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent({
        id: uuidv4(),
        eventType: 'attestation',
        data: {
          type: 'attestation',
          category: 'quality',
          confidence: 0.9,
          comment: '<script>alert(1)</script>',
        },
      }));

      const res = await request(app).get(`/explorer/${AGENT_ID}`).expect(200);

      expect(res.text).not.toContain('<script>alert(1)</script>');
      expect(res.text).toContain('&lt;script&gt;');
    });
  });
});
