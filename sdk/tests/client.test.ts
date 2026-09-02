import { describe, it, expect, vi, beforeEach } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ReputationOracleClient } from '../src/client.js';
import {
  AgentNotFoundError,
  PaymentRequiredError,
  ValidationError,
  RateLimitError,
  OracleHttpError,
} from '../src/errors.js';
import type {
  EvmAddress,
  HealthResponse,
  ReputationResponse,
  ReputationSummary,
  AttestationsResponse,
  EventSubmissionResponse,
  ReputationVector,
  SignedReceipt,
} from '../src/types.js';
import { hashReputationVector, getOracleDomain, RECEIPT_TYPES } from '../src/signing.js';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ORACLE_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ORACLE_ACCOUNT = privateKeyToAccount(ORACLE_PRIVATE_KEY);

const AGENT_ID = '0x1234567890123456789012345678901234567890' as EvmAddress;

function mockFetch(body: unknown, status: number = 200): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof globalThis.fetch;
}

describe('ReputationOracleClient', () => {
  let client: ReputationOracleClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  function createClient(
    overrides: Partial<{ fetch: typeof globalThis.fetch; privateKey: `0x${string}` }> = {},
  ): ReputationOracleClient {
    const f = overrides.fetch ?? mockFetch({});
    fetchSpy = f as unknown as ReturnType<typeof vi.fn>;
    return new ReputationOracleClient({
      oracleUrl: 'https://oracle.example.com',
      privateKey: overrides.privateKey,
      fetch: f,
    });
  }

  describe('health()', () => {
    it('fetches health endpoint', async () => {
      const body: HealthResponse = {
        status: 'ok',
        oracle: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        network: 'eip155:84532',
        timestamp: '2025-01-01T00:00:00.000Z',
      };
      client = createClient({ fetch: mockFetch(body) });

      const result = await client.health();
      expect(result).toEqual(body);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oracle.example.com/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getReputation()', () => {
    it('fetches reputation for an agent', async () => {
      const body: ReputationResponse = {
        agentId: AGENT_ID,
        vector: {
          reliabilityScore: 0.95,
          completionRate: 0.9,
          disputeRate: 0.02,
          slaAdherence: 0.88,
          volumeWeight: 0.7,
          totalEvents: 10,
          lastEventTimestamp: '2025-01-01T00:00:00.000Z',
          computedAt: '2025-01-01T00:00:00.000Z',
        },
        receipt: {} as SignedReceipt,
      };
      client = createClient({ fetch: mockFetch(body) });

      const result = await client.getReputation(AGENT_ID);
      expect(result.agentId).toBe(AGENT_ID);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://oracle.example.com/reputation/${AGENT_ID}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getSummary()', () => {
    it('fetches reputation summary', async () => {
      const body: ReputationSummary = {
        agentId: AGENT_ID,
        reliabilityScore: 0.95,
        completionRate: 0.9,
        disputeRate: 0.02,
        slaAdherence: 0.88,
        volumeWeight: 0.7,
        totalEvents: 10,
        isActive: true,
        confidence: 0.8,
        lastEventTimestamp: '2025-01-01T00:00:00.000Z',
        computedAt: '2025-01-01T00:00:00.000Z',
      };
      client = createClient({ fetch: mockFetch(body) });

      const result = await client.getSummary(AGENT_ID);
      expect(result.agentId).toBe(AGENT_ID);
      expect(result.isActive).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://oracle.example.com/reputation/${AGENT_ID}/summary`,
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getAttestations()', () => {
    it('fetches attestations with default options', async () => {
      const body: AttestationsResponse = {
        agentId: AGENT_ID,
        events: [],
        pagination: { limit: 50, offset: 0, count: 0 },
      };
      client = createClient({ fetch: mockFetch(body) });

      const result = await client.getAttestations(AGENT_ID);
      expect(result.agentId).toBe(AGENT_ID);
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://oracle.example.com/reputation/${AGENT_ID}/attestations`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('passes query parameters', async () => {
      const body: AttestationsResponse = {
        agentId: AGENT_ID,
        events: [],
        pagination: { limit: 10, offset: 5, count: 0 },
      };
      client = createClient({ fetch: mockFetch(body) });

      await client.getAttestations(AGENT_ID, {
        limit: 10,
        offset: 5,
        eventType: 'attestation',
      });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('limit=10');
      expect(url).toContain('offset=5');
      expect(url).toContain('type=attestation');
    });
  });

  describe('submitEvent()', () => {
    it('throws if no private key configured', async () => {
      client = createClient();

      await expect(
        client.submitEvent(AGENT_ID, {
          type: 'transaction_completed',
          completedSuccessfully: true,
          valueUsd: 100,
          durationMs: 5000,
        }),
      ).rejects.toThrow('privateKey is required');
    });

    it('signs and submits an event', async () => {
      const responseBody: EventSubmissionResponse = {
        accepted: true,
        eventId: 'test-uuid',
        attestation: {
          signature: '0xabc',
          signer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
          eventId: 'test-uuid',
          agentId: AGENT_ID,
          timestamp: '2025-01-01T00:00:00.000Z',
        },
      };
      client = createClient({
        fetch: mockFetch(responseBody, 201),
        privateKey: TEST_PRIVATE_KEY,
      });

      const result = await client.submitEvent(AGENT_ID, {
        type: 'transaction_completed',
        completedSuccessfully: true,
        valueUsd: 100,
        durationMs: 5000,
      });

      expect(result.accepted).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oracle.example.com/reputation/event',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        }),
      );

      // Verify the body contains a properly structured event
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
      expect(sentBody.agentId).toBe(AGENT_ID);
      expect(sentBody.eventType).toBe('transaction_completed');
      expect(sentBody.proof).toBeDefined();
      expect(sentBody.proof.signature).toMatch(/^0x[0-9a-f]+$/i);
      expect(sentBody.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe('getEvents()', () => {
    it('pages the free event log with after/limit', async () => {
      const body = { events: [{ seq: 7, id: 'e' }], nextAfter: 7, limit: 2 };
      client = createClient({ fetch: mockFetch(body) });
      const page = await client.getEvents({ after: 5, limit: 2 });
      expect(page.nextAfter).toBe(7);
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://oracle.example.com/v1/events?after=5&limit=2',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('getAgent()', () => {
    it('fetches the free agent record', async () => {
      const body = { id: AGENT_ID, createdAt: 't', updatedAt: 't', previousAddresses: [], metadata: { erc8004: { tokenId: '1' } } };
      client = createClient({ fetch: mockFetch(body) });
      const agent = await client.getAgent(AGENT_ID);
      expect(agent.metadata).toEqual({ erc8004: { tokenId: '1' } });
      expect(fetchSpy).toHaveBeenCalledWith(
        `https://oracle.example.com/v1/agents/${AGENT_ID}`,
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('maps 404 to AgentNotFoundError', async () => {
      client = createClient({ fetch: mockFetch({ error: 'Agent not found' }, 404) });
      await expect(client.getAgent(AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
    });
  });

  describe('verifyReceipt()', () => {
    it('verifies a valid receipt from the oracle', async () => {
      const vector: ReputationVector = {
        reliabilityScore: 0.95,
        completionRate: 0.9,
        disputeRate: 0.02,
        slaAdherence: 0.88,
        volumeWeight: 0.7,
        totalEvents: 42,
        lastEventTimestamp: '2025-01-01T00:00:00.000Z',
        computedAt: '2025-01-01T00:00:00.000Z',
      };

      const vectorHash = hashReputationVector(vector);
      const timestamp = '2025-01-01T12:00:00.000Z';
      const signature = await ORACLE_ACCOUNT.signTypedData({
        domain: getOracleDomain(84532),
        types: RECEIPT_TYPES,
        primaryType: 'ReputationReceipt',
        message: {
          agentId: AGENT_ID,
          vectorHash,
          timestamp,
          totalEvents: BigInt(42),
        },
      });

      const receipt: SignedReceipt = {
        agentId: AGENT_ID,
        vector,
        vectorHash,
        signature,
        timestamp,
        oracleAddress: ORACLE_ACCOUNT.address,
      };

      client = createClient();
      const valid = await client.verifyReceipt(receipt);
      expect(valid).toBe(true);
    });
  });

  describe('error mapping', () => {
    it('maps 400 to ValidationError', async () => {
      client = createClient({
        fetch: mockFetch({ error: 'Invalid input' }, 400),
      });
      await expect(client.health()).rejects.toThrow(ValidationError);
    });

    it('maps 402 to PaymentRequiredError', async () => {
      client = createClient({
        fetch: mockFetch({ error: 'Payment required' }, 402),
      });
      await expect(client.health()).rejects.toThrow(PaymentRequiredError);
    });

    it('maps 404 to AgentNotFoundError', async () => {
      client = createClient({
        fetch: mockFetch({ error: 'Not found' }, 404),
      });
      await expect(client.getReputation(AGENT_ID)).rejects.toThrow(AgentNotFoundError);
    });

    it('maps 429 to RateLimitError', async () => {
      client = createClient({
        fetch: mockFetch({ error: 'Rate limited' }, 429),
      });
      await expect(client.health()).rejects.toThrow(RateLimitError);
    });

    it('maps unknown status to OracleHttpError', async () => {
      client = createClient({
        fetch: mockFetch({ error: 'Server error' }, 500),
      });
      await expect(client.health()).rejects.toThrow(OracleHttpError);
      try {
        await client.health();
      } catch (e) {
        expect((e as OracleHttpError).status).toBe(500);
      }
    });

    it('preserves error body', async () => {
      const body = { error: 'Validation failed', details: ['field required'] };
      client = createClient({ fetch: mockFetch(body, 400) });
      try {
        await client.health();
      } catch (e) {
        expect((e as OracleHttpError).body).toEqual(body);
      }
    });
  });

  describe('URL handling', () => {
    it('strips trailing slashes from oracleUrl', async () => {
      const f = mockFetch({});
      const c = new ReputationOracleClient({
        oracleUrl: 'https://oracle.example.com///',
        fetch: f,
      });
      await c.health();
      const spy = f as unknown as ReturnType<typeof vi.fn>;
      expect(spy.mock.calls[0][0]).toBe('https://oracle.example.com/health');
    });
  });
});
