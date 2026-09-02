import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { v4 as uuidv4 } from 'uuid';
import { createOracleApp, type OracleApp } from '../../src/app.js';
import {
  getReputationOracleDomain,
  REPUTATION_EVENT_TYPES,
} from '../../src/crypto/signing.js';
import type { AppConfig, EvmAddress, ReputationEventData } from '../../src/types/index.js';

const ORACLE_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ATTESTER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const SUBJECT_AGENT_ID =
  '0x1111111111111111111111111111111111111111' as EvmAddress;

const attester = privateKeyToAccount(ATTESTER_PRIVATE_KEY);

const config: AppConfig = {
  port: 3402,
  nodeEnv: 'test',
  x402: {
    network: 'eip155:84532',
    payTo: '0x0000000000000000000000000000000000000000',
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

async function signedEvent(data: ReputationEventData) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const dataHash = keccak256(toHex(JSON.stringify(data)));

  const signature = await attester.signTypedData({
    domain: getReputationOracleDomain(),
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message: {
      id,
      agentId: SUBJECT_AGENT_ID,
      eventType: data.type,
      timestamp,
      dataHash,
    },
  });

  return {
    id,
    agentId: SUBJECT_AGENT_ID,
    eventType: data.type,
    timestamp,
    data,
    proof: {
      signature,
      signer: attester.address,
      domain: 'AgentReputationOracle',
      typedDataHash: dataHash,
    },
    sourceAgentId: attester.address,
  };
}

describe('versioned API contract', () => {
  let oracle: OracleApp | null = null;

  afterEach(() => {
    oracle?.close();
    oracle = null;
  });

  it('accepts a signed event, returns reputation, and verifies the receipt', async () => {
    oracle = createOracleApp(config);

    const health = await request(oracle.app)
      .get('/v1/health')
      .expect(200);

    expect(health.body.status).toBe('ok');
    expect(health.body.oracle).toBe(oracle.attestationService.oracleAddress);

    const event = await signedEvent({
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 75,
      durationMs: 2500,
    });

    const submitted = await request(oracle.app)
      .post('/v1/reputation/event')
      .send(event)
      .expect(201);

    expect(submitted.body.accepted).toBe(true);
    expect(submitted.body.eventId).toBe(event.id);

    const reputation = await request(oracle.app)
      .get(`/v1/reputation/${SUBJECT_AGENT_ID}`)
      .expect(200);

    expect(reputation.body.agentId).toBe(SUBJECT_AGENT_ID);
    expect(reputation.body.vector.totalEvents).toBe(1);

    await expect(
      oracle.receiptService.verifyReceipt(reputation.body.receipt),
    ).resolves.toBe(true);
  });

  it('exports the raw log at GET /v1/events so a consumer can recompute without the oracle key', async () => {
    oracle = createOracleApp(config);
    const first = await signedEvent({ type: 'transaction_completed', completedSuccessfully: true, valueUsd: 1, durationMs: 1 });
    const second = await signedEvent({ type: 'transaction_completed', completedSuccessfully: false, valueUsd: 2, durationMs: 2 });
    await request(oracle.app).post('/v1/reputation/event').send(first).expect(201);
    await request(oracle.app).post('/v1/reputation/event').send(second).expect(201);

    const page1 = await request(oracle.app).get('/v1/events?limit=1').expect(200);
    expect(page1.body.events).toHaveLength(1);
    expect(page1.body.events[0].id).toBe(first.id);
    expect(page1.body.events[0].proof.signature).toBe(first.proof.signature);
    expect(page1.body.nextAfter).toBe(page1.body.events[0].seq);

    const page2 = await request(oracle.app).get(`/v1/events?after=${page1.body.nextAfter}`).expect(200);
    expect(page2.body.events.map((e: { id: string }) => e.id)).toEqual([second.id]);

    const page3 = await request(oracle.app).get(`/v1/events?after=${page2.body.nextAfter}`).expect(200);
    expect(page3.body.events).toEqual([]);
    expect(page3.body.nextAfter).toBe(page2.body.nextAfter);

    const bad = await request(oracle.app).get('/v1/events?after=abc&limit=99999').expect(200);
    expect(bad.body.events).toHaveLength(2);
    expect(bad.body.limit).toBe(1000);
  });

  it('GET /v1/agents/:agentId returns the free agent record and 404/400 otherwise', async () => {
    oracle = createOracleApp(config);
    oracle.eventLog.ensureAgent(SUBJECT_AGENT_ID, { erc8004: { chainId: 8453, tokenId: '1', uriUpdates: [] } });

    const found = await request(oracle.app).get(`/v1/agents/${SUBJECT_AGENT_ID}`).expect(200);
    expect(found.body.id).toBe(SUBJECT_AGENT_ID);
    expect(found.body.metadata.erc8004.tokenId).toBe('1');
    expect(found.body.eventsUnderCurrentUri).toBe(0);

    await request(oracle.app).get('/v1/agents/0x9999999999999999999999999999999999999999').expect(404);
    await request(oracle.app).get('/v1/agents/nope').expect(400);
  });

  it('serves the public-surface floor and keeps the API out of the index', async () => {
    oracle = createOracleApp(config);
    const root = await request(oracle.app).get('/').expect(302);
    expect(root.headers['location']).toBe('/explorer');
    const robots = await request(oracle.app).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Disallow: /v1/');
    expect(robots.text).toMatch(/Sitemap: http:\/\/.+\/sitemap\.xml/);
    const sitemap = await request(oracle.app).get('/sitemap.xml').expect(200);
    expect(sitemap.text).toContain('/explorer</loc>');
    const llms = await request(oracle.app).get('/llms.txt').expect(200);
    expect(llms.text).toContain('/v1/events');
    const api = await request(oracle.app).get('/v1/events').expect(200);
    expect(api.headers['x-robots-tag']).toBe('noindex');
  });
});
