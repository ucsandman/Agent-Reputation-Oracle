# @agent-reputation-oracle/sdk

TypeScript SDK client for the [Agent Reputation Oracle](../README.md). Query, submit, and verify cryptographic reputation signals for autonomous AI agents via EIP-712 signed requests and x402 micropayments.

## Install

```bash
npm install @agent-reputation-oracle/sdk
```

**Peer requirement:** Node.js >= 18 (uses native `fetch`).

## Quick Start

### Query an Agent's Reputation

```typescript
import { ReputationOracleClient } from '@agent-reputation-oracle/sdk';

const client = new ReputationOracleClient({
  oracleUrl: 'http://localhost:3402',
});

const { vector, receipt } = await client.getReputation(
  '0x1234567890123456789012345678901234567890',
);

console.log(`Reliability: ${vector.reliabilityScore}`);
console.log(`Total events: ${vector.totalEvents}`);
```

### Submit a Reputation Event

```typescript
import { ReputationOracleClient } from '@agent-reputation-oracle/sdk';

const client = new ReputationOracleClient({
  oracleUrl: 'http://localhost:3402',
  privateKey: '0xYOUR_PRIVATE_KEY', // Agent's private key for EIP-712 signing
});

const result = await client.submitEvent(
  '0xTARGET_AGENT_ADDRESS', // Agent being reviewed
  {
    type: 'transaction_completed',
    completedSuccessfully: true,
    valueUsd: 50,
    durationMs: 3000,
  },
);

console.log(`Event accepted: ${result.accepted}`);
console.log(`Event ID: ${result.eventId}`);
```

### Verify a Receipt

```typescript
import { ReputationOracleClient } from '@agent-reputation-oracle/sdk';

const client = new ReputationOracleClient({
  oracleUrl: 'http://localhost:3402',
});

const { receipt } = await client.getReputation('0xAGENT_ADDRESS');
const isValid = await client.verifyReceipt(receipt);
console.log(`Receipt valid: ${isValid}`);
```

You can also verify receipts without a client instance:

```typescript
import { verifyReceipt } from '@agent-reputation-oracle/sdk';

const isValid = await verifyReceipt(receipt, 84532); // chainId
```

## API Reference

### `new ReputationOracleClient(config)`

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `oracleUrl` | `string` | Yes | — | Base URL of the oracle |
| `privateKey` | `` `0x${string}` `` | No | — | Agent's private key (required for `submitEvent`) |
| `chainId` | `number` | No | `84532` | Chain ID for EIP-712 domain (Base Sepolia) |
| `fetch` | `typeof fetch` | No | `globalThis.fetch` | Custom fetch implementation |

### Methods

#### `health(): Promise<HealthResponse>`

Returns oracle status, address, network, and timestamp.

#### `getReputation(agentId): Promise<ReputationResponse>`

Returns the full reputation vector and a cryptographically signed receipt.

#### `getSummary(agentId): Promise<ReputationSummary>`

Returns a lightweight reputation summary with confidence and activity status.

#### `getAttestations(agentId, options?): Promise<AttestationsResponse>`

Returns paginated event history for an agent.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `limit` | `number` | `50` | Max events to return (1-100) |
| `offset` | `number` | `0` | Pagination offset |
| `eventType` | `ReputationEventType` | — | Filter by event type |

#### `submitEvent(agentId, data): Promise<EventSubmissionResponse>`

Signs and submits a reputation event. Requires `privateKey` in config.

**Event types:**
- `transaction_completed` — Record a completed transaction
- `sla_verified` — Record SLA measurement
- `arbitration_result` — Record arbitration outcome
- `slash` — Record a penalty event
- `attestation` — Record a qualitative attestation

#### `verifyReceipt(receipt): Promise<boolean>`

Verifies the oracle's EIP-712 signature on a reputation receipt, including vector hash integrity.

## Error Handling

All HTTP errors throw typed error classes:

```typescript
import {
  OracleError,          // Base error
  OracleHttpError,      // HTTP error (has .status, .body)
  ValidationError,      // 400
  PaymentRequiredError,  // 402
  AgentNotFoundError,   // 404
  RateLimitError,       // 429
} from '@agent-reputation-oracle/sdk';

try {
  await client.getReputation('0xAGENT');
} catch (err) {
  if (err instanceof AgentNotFoundError) {
    console.log('Agent has no reputation data');
  } else if (err instanceof PaymentRequiredError) {
    console.log('x402 payment needed');
  }
}
```

## Standalone Utilities

The SDK exports signing utilities for advanced use:

```typescript
import {
  createSignedEvent,    // Build and sign a ReputationEvent
  verifyReceipt,        // Verify oracle receipt signature
  hashEventData,        // keccak256 hash of event data
  hashReputationVector, // keccak256 hash of reputation vector
  getOracleDomain,      // EIP-712 domain for a chain ID
} from '@agent-reputation-oracle/sdk';
```

## Development

```bash
npm install
npm run typecheck  # tsc --noEmit
npm test           # vitest
npm run build      # compile to dist/
```
