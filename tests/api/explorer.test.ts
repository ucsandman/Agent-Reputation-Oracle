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
      expect(res.text).toContain(`<link rel="canonical" href="/explorer/${AGENT_ID}">`);
      expect(res.text).toMatch(/<meta name="description" content="Reputation \d+\/100 for agent/);
    });

    it('redirects an ERC-8004 chain/token pair to the derived agent address', async () => {
      const res = await request(app).get('/explorer/erc8004/8453/55867').expect(302);
      expect(res.headers['location']).toBe('/explorer/0x3219091d9Dd2Fc8D8912cf1565d23d2a7C23CC8c');
      await request(app).get('/explorer/erc8004/999/1').expect(400);
    });

    it('returns 400 for invalid address', async () => {
      await request(app).get('/explorer/not-an-address').expect(400);
    });

    it('shows ERC-8004 agentURI change history from metadata', async () => {
      eventLog.ensureAgent(AGENT_ID, {
        erc8004: {
          chainId: 8453, identityRegistry: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', tokenId: '55867',
          uriUpdates: [{ timestamp: '2026-08-31T10:02:20.000Z', updatedBy: '0x164AfDf1FEE71A07057e1d7086e1B10590F3b250', txHash: '0xce2c', logIndex: 3, blockNumber: 50690598, newURI: 'data:x' }],
        },
      });
      eventLog.ensureAgent(SOURCE_AGENT_ID);
      eventLog.appendEvent(makeEvent());

      const res = await request(app).get(`/explorer/${AGENT_ID}`).expect(200);

      expect(res.text).toContain('agentURI changed 1 time on chain');
      expect(res.text).toContain('0x164AfDf1FEE71A07057e1d7086e1B10590F3b250');
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
