# Architecture

## Overview

The Agent Reputation Oracle is an HTTP service that computes, stores, and serves reputation vectors for EVM-identified AI agents. Every API call (except `/v1/health`) requires an x402 micropayment in production. Reputation events are submitted by third-party attesters, stored in an append-only SQLite log, and aggregated into a multi-dimensional reputation vector using time-decayed Bayesian scoring.

## Components

```
src/
  server.ts            Express app bootstrap, route mounting, health check
  config.ts            Zod-validated environment config loader
  types/index.ts       All TypeScript interfaces and type aliases
  models/event.ts      Zod schemas for request validation

  reputation/
    decay.ts           Exponential time-decay weight function
    math.ts            Bayesian scoring for each reputation dimension
    engine.ts          ReputationEngine: vector computation + collusion discount

  storage/
    event-log.ts       EventLog: append-only event store + agent registry
    cache.ts           ReputationCache: materialized vector cache with staleness check
    migrations.ts      SQLite schema migrations (versioned)

  crypto/
    signing.ts         EIP-712 domain, type definitions, hash + verify utilities
    attestation.ts     AttestationService: signs event-acceptance attestations
    receipt.ts         ReceiptService: signs reputation receipts

  routes/
    reputation.ts      GET /:agentId, GET /:agentId/summary, GET /:agentId/attestations
    events.ts          POST /v1/reputation/event

  x402/
    middleware.ts      x402 payment middleware configuration
    pricing.ts         Price formatting helper
```

## Data Flow

```
  Agent A (attester)                    Agent B (subject)
      |                                      |
      |  1. Signs EIP-712 typed data         |
      |     for a reputation event           |
      |                                      |
      v                                      |
 +----------+    x402 payment    +-----------+----------+
 |  POST    | -----------------> |                      |
 | /event   |   free (default)  |   x402 Middleware     |
 +----------+                   |   (facilitator)       |
      |                         +-----------+----------+
      |                                     |
      v                                     v
 +---------------------------------------------------+
 |              Events Router                         |
 |  1. Zod validation                                 |
 |  2. Reject self-attestation (agentId == source)    |
 |  3. Verify EIP-712 signature                       |
 |  4. Rate limit check (100/agent/hour)              |
 |  5. Idempotency check (duplicate event ID)         |
 |  6. Append to event log                            |
 |  7. Invalidate reputation cache                    |
 |  8. Return signed acceptance attestation           |
 +---------------------------------------------------+
      |
      v
 +---------------------------------------------------+
 |              SQLite (WAL mode)                     |
 |                                                    |
 |  agents          Registered agent identities       |
 |  events          Append-only event log             |
 |  reputation_cache  Materialized vector cache       |
 |  schema_version  Migration tracking                |
 +---------------------------------------------------+
      ^
      |  Read path
      |
 +---------------------------------------------------+
 |          Reputation Router                         |
 |                                                    |
 |  GET /:agentId                                     |
 |    -> Check cache staleness                        |
 |    -> Recompute vector if stale                    |
 |    -> Sign receipt (EIP-712)                       |
 |    -> Return vector + receipt                      |
 |                                                    |
 |  GET /:agentId/summary                             |
 |    -> Same compute, return lightweight summary     |
 |                                                    |
 |  GET /:agentId/attestations                        |
 |    -> Paginated query over event log               |
 +---------------------------------------------------+
```

## x402 Payment Integration

All endpoints except `GET /v1/health` are gated by the `@x402/express` payment middleware in production. The middleware intercepts requests before they reach route handlers.

**Flow:**
1. Client sends request with `X-PAYMENT` header containing a signed x402 payment proof.
2. Middleware forwards the proof to the configured facilitator (`https://facilitator.x402.org`).
3. Facilitator verifies the payment was made on the configured network (Base Sepolia, `eip155:84532`).
4. If valid, the request proceeds to the route handler. If invalid, a `402 Payment Required` response is returned with pricing metadata.

**Route pricing:**

| Route                              | Price (USD) |
|------------------------------------|-------------|
| `GET /v1/reputation/:agentId`         | $0.001      |
| `GET /v1/reputation/:agentId/summary` | $0.0005     |
| `GET /v1/reputation/:agentId/attestations` | $0.001 |
| `POST /v1/reputation/event`           | free (default) |

Payments are sent to the address configured in `X402_PAY_TO`. The scheme is `exact` (EVM exact payment via `@x402/evm`).

## Storage Model

**Database:** SQLite via `better-sqlite3`.

**Pragmas set at initialization:**
- `journal_mode = WAL` -- Write-Ahead Logging for concurrent read/write
- `foreign_keys = ON` -- Referential integrity enforcement
- `busy_timeout = 5000` -- 5-second busy retry for lock contention

**Tables:**

| Table              | Purpose                                              |
|--------------------|------------------------------------------------------|
| `agents`           | Agent registry. Stores EVM address, creation time, previous addresses (key rotation), metadata. |
| `events`           | Append-only event log. Each row is an immutable reputation event with full proof data. `INSERT OR IGNORE` ensures idempotency. |
| `reputation_cache` | Materialized reputation vector per agent. Invalidated on new event insert. Recomputed lazily on next query. |
| `schema_version`   | Single-row table tracking current migration version. |

**Append-only guarantees:**
- Events are inserted with `INSERT OR IGNORE` (idempotent by event UUID).
- No `UPDATE` or `DELETE` operations exist for the `events` table.
- The full event history is always available for recomputation.

**Cache invalidation:**
- On event insert: `cache.invalidate(agentId)` deletes the cached row.
- On reputation query: `cache.isStale(agentId)` checks if any events were created after `last_computed_at`.
- If stale or missing, the vector is recomputed from all events and cached.

## EIP-712 Signing

Three EIP-712 typed data structures are used:

1. **ReputationEvent** -- Signed by attesters when submitting events. Fields: `id`, `agentId`, `eventType`, `timestamp`, `dataHash`.
2. **ReputationReceipt** -- Signed by the oracle when returning reputation queries. Fields: `agentId`, `vectorHash`, `timestamp`, `totalEvents`.
3. **EventAcceptance** -- Signed by the oracle to acknowledge event ingestion. Fields: `eventId`, `agentId`, `timestamp`.

All share the domain:
```
{
  name: "AgentReputationOracle",
  version: "1",
  chainId: 84532,
  verifyingContract: "0x0000000000000000000000000000000000000000"
}
```

## Key Rotation

The `agents` table stores `previous_addresses` as a JSON array. `EventLog.rotateAgentKey(oldAddress, newAddress)` creates a new agent record carrying forward the address history and metadata. A `KeyRotation` EIP-712 type is defined in `signing.ts` for future on-chain verification.
