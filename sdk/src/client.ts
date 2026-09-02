import { privateKeyToAccount } from 'viem/accounts';
import type {
  OracleClientConfig,
  EvmAddress,
  ReputationEventData,
  ReputationResponse,
  ReputationSummary,
  AttestationsResponse,
  EventSubmissionResponse,
  EventQueryOptions,
  HealthResponse,
  SignedReceipt,
  EventsQueryOptions,
  EventsPage,
  AgentRecord,
} from './types.js';
import {
  OracleHttpError,
  AgentNotFoundError,
  PaymentRequiredError,
  ValidationError,
  RateLimitError,
} from './errors.js';
import { createSignedEvent, verifyReceipt as verifyReceiptFn } from './signing.js';

export class ReputationOracleClient {
  private readonly baseUrl: string;
  private readonly chainId: number;
  private readonly privateKey?: `0x${string}`;
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(config: OracleClientConfig) {
    this.baseUrl = config.oracleUrl.replace(/\/+$/, '');
    this.chainId = config.chainId ?? 84532;
    this.privateKey = config.privateKey;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  // ─── Public API ───

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }

  async getReputation(agentId: EvmAddress): Promise<ReputationResponse> {
    return this.request<ReputationResponse>('GET', `/reputation/${agentId}`);
  }

  async getSummary(agentId: EvmAddress): Promise<ReputationSummary> {
    return this.request<ReputationSummary>('GET', `/reputation/${agentId}/summary`);
  }

  async getAttestations(
    agentId: EvmAddress,
    options?: EventQueryOptions,
  ): Promise<AttestationsResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    if (options?.eventType) params.set('type', options.eventType);

    const qs = params.toString();
    const path = `/reputation/${agentId}/attestations${qs ? `?${qs}` : ''}`;
    return this.request<AttestationsResponse>('GET', path);
  }

  async submitEvent(
    agentId: EvmAddress,
    data: ReputationEventData,
  ): Promise<EventSubmissionResponse> {
    if (!this.privateKey) {
      throw new Error('privateKey is required in OracleClientConfig to submit events');
    }

    const event = await createSignedEvent({
      privateKey: this.privateKey,
      agentId,
      eventType: data.type,
      data,
      chainId: this.chainId,
    });

    return this.request<EventSubmissionResponse>('POST', '/reputation/event', event);
  }

  /** Free, unsigned page of the raw event log for independent recomputation. Loop until `events` is empty. */
  async getEvents(options?: EventsQueryOptions): Promise<EventsPage> {
    const params = new URLSearchParams();
    if (options?.after !== undefined) params.set('after', String(options.after));
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    const qs = params.toString();
    return this.request<EventsPage>('GET', `/v1/events${qs ? `?${qs}` : ''}`);
  }

  /** Free agent record with identity metadata (ERC-8004 token and agentURI change history). */
  async getAgent(agentId: EvmAddress): Promise<AgentRecord> {
    return this.request<AgentRecord>('GET', `/v1/agents/${agentId}`);
  }

  async verifyReceipt(receipt: SignedReceipt): Promise<boolean> {
    return verifyReceiptFn(receipt, this.chainId);
  }

  // ─── Internal ───

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let responseBody: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    if (!response.ok) {
      throw this.mapHttpError(response.status, responseBody);
    }

    return responseBody as T;
  }

  private mapHttpError(status: number, body: unknown): OracleHttpError {
    switch (status) {
      case 400:
        return new ValidationError(body);
      case 402:
        return new PaymentRequiredError(body);
      case 404:
        return new AgentNotFoundError(body);
      case 429:
        return new RateLimitError(body);
      default:
        return new OracleHttpError(`HTTP ${status}`, status, body);
    }
  }
}
