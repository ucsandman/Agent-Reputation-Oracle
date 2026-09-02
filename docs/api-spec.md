# API Specification

Base URL: `http://localhost:3402`

All endpoints except `/v1/health` require x402 payment. Requests without a valid `X-PAYMENT` header receive `402 Payment Required` with pricing metadata in the response.
Unversioned routes remain available as backward-compatible aliases.

## Authentication via x402

Paid endpoints require the `X-PAYMENT` header containing a signed payment proof. The x402 facilitator verifies payment was made on Base Sepolia (`eip155:84532`) in USDC.

```
X-PAYMENT: <base64-encoded-x402-payment-proof>
```

On `402` response, the server returns:
```json
{
  "error": "Payment Required",
  "accepts": {
    "scheme": "exact",
    "network": "eip155:84532",
    "payTo": "0x...",
    "price": "$0.001",
    "maxTimeoutSeconds": 60
  }
}
```

---

## GET /v1/health

Free endpoint. No payment required.

**Response 200:**
```json
{
  "status": "ok",
  "oracle": "0xOracleAddress",
  "network": "eip155:84532",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

---

## GET /v1/events

**Free.** Raw, append-order export of the whole event log, intended for consumers that
want to recompute reputation locally instead of trusting the oracle's receipt key.
Every event carries the attester's original EIP-712 `proof`, so each one can be verified
independently, and `seq` is a monotonic cursor (SQLite rowid) that never repeats or skips.

**Query parameters:**
- `after` (integer, default `0`): return events with `seq` greater than this.
- `limit` (integer, 1-1000, default `500`).

**Response 200:**
```json
{
  "events": [ { "seq": 1, "id": "…", "agentId": "0x…", "eventType": "attestation", "timestamp": "…", "data": { … }, "proof": { … }, "sourceAgentId": "0x…" } ],
  "nextAfter": 1,
  "limit": 500
}
```

Loop with `after = nextAfter` until `events` is empty. Events imported from ERC-8004 carry
`proof.domain = "erc8004:<chainId>"` and a transaction hash as `proof.signature` instead of
an EIP-712 signature; see [erc8004.md](./erc8004.md).

## GET /v1/agents/:agentId

**Free.** The agent record: id, timestamps, previous addresses after key rotation, and
identity metadata. For agents imported from ERC-8004 the metadata carries the token behind
the address and every on-chain `agentURI` change, so a consumer can tell when the runtime
behind an id was swapped and discount older history.

**Response 200:**
```json
{
  "id": "0x…",
  "createdAt": "…",
  "updatedAt": "…",
  "previousAddresses": [],
  "metadata": {
    "erc8004": {
      "chainId": 8453,
      "identityRegistry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      "tokenId": "55867",
      "owner": "0x…",
      "uriUpdates": [
        { "txHash": "0x…", "logIndex": 3, "blockNumber": 50690598, "timestamp": "…", "updatedBy": "0x…", "newURI": "…" }
      ]
    }
  }
}
```

**Errors:** `400` invalid address, `404` unknown agent.

## GET /v1/reputation/:agentId

Full reputation vector with EIP-712 signed receipt.

**Price:** $0.001

**Path parameters:**
- `agentId` -- EVM address (checksummed or lowercase, e.g., `0x1234...abcd`)

**Response 200:**
```json
{
  "agentId": "0x1234567890abcdef1234567890abcdef12345678",
  "vector": {
    "reliabilityScore": 0.643,
    "completionRate": 0.820,
    "disputeRate": 0.036,
    "slaAdherence": 0.867,
    "volumeWeight": 1.386,
    "totalEvents": 3,
    "lastEventTimestamp": "2025-01-15T09:00:00.000Z",
    "computedAt": "2025-01-15T10:30:00.000Z"
  },
  "receipt": {
    "agentId": "0x1234567890abcdef1234567890abcdef12345678",
    "vector": { "...same as above..." },
    "vectorHash": "0xabc123...",
    "signature": "0xdef456...",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "oracleAddress": "0xOracleAddress"
  }
}
```

**Error responses:**

| Status | Body |
|--------|------|
| 400    | `{ "error": "Invalid EVM address" }` |
| 402    | Payment required (see x402 section) |
| 404    | `{ "error": "Agent not found" }` |
| 500    | `{ "error": "Internal server error" }` |

---

## GET /v1/reputation/:agentId/summary

Lightweight reputation summary without a signed receipt.

**Price:** $0.0005

**Path parameters:**
- `agentId` -- EVM address

**Response 200:**
```json
{
  "agentId": "0x1234567890abcdef1234567890abcdef12345678",
  "reliabilityScore": 0.643,
  "completionRate": 0.820,
  "disputeRate": 0.036,
  "slaAdherence": 0.867,
  "volumeWeight": 1.386,
  "totalEvents": 3,
  "isActive": true,
  "confidence": 0.129,
  "lastEventTimestamp": "2025-01-15T09:00:00.000Z",
  "computedAt": "2025-01-15T10:30:00.000Z"
}
```

**Error responses:** Same as `GET /v1/reputation/:agentId`.

---

## GET /v1/reputation/:agentId/attestations

Paginated event history for an agent.

**Price:** $0.001

**Path parameters:**
- `agentId` -- EVM address

**Query parameters:**

| Param    | Type    | Default | Constraints       | Description                     |
|----------|---------|---------|-------------------|---------------------------------|
| `limit`  | integer | 50      | 1-100             | Max events per page             |
| `offset` | integer | 0       | >= 0              | Number of events to skip        |
| `type`   | string  | (all)   | See event types   | Filter by event type            |

Valid `type` values: `transaction_completed`, `sla_verified`, `arbitration_result`, `slash`, `attestation`.

**Response 200:**
```json
{
  "agentId": "0x1234567890abcdef1234567890abcdef12345678",
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "agentId": "0x1234567890abcdef1234567890abcdef12345678",
      "eventType": "transaction_completed",
      "timestamp": "2025-01-15T09:00:00.000Z",
      "data": {
        "type": "transaction_completed",
        "completedSuccessfully": true,
        "valueUsd": 50.00,
        "durationMs": 12000
      },
      "proof": {
        "signature": "0x...",
        "signer": "0xAttesterAddress",
        "domain": "AgentReputationOracle",
        "typedDataHash": "0x..."
      },
      "sourceAgentId": "0xAttesterAddress"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "count": 1
  }
}
```

**Error responses:**

| Status | Body |
|--------|------|
| 400    | `{ "error": "Invalid EVM address" }` or `{ "error": "Invalid query parameters", "details": [...] }` |
| 402    | Payment required |
| 404    | `{ "error": "Agent not found" }` |

---

## POST /v1/reputation/event

Submit a signed reputation event for an agent.

**Price:** free by default (PRICE_EVENT_SUBMIT=0); when a price is set, x402 payment is required

**Request body:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "agentId": "0xSubjectAgentAddress",
  "eventType": "transaction_completed",
  "timestamp": "2025-01-15T09:00:00.000Z",
  "data": {
    "type": "transaction_completed",
    "completedSuccessfully": true,
    "valueUsd": 50.00,
    "durationMs": 12000
  },
  "proof": {
    "signature": "0x...",
    "signer": "0xAttesterAddress",
    "domain": "AgentReputationOracle",
    "typedDataHash": "0x..."
  },
  "sourceAgentId": "0xAttesterAddress"
}
```

**Validation rules:**
- `id` must be UUID v4
- `agentId` and `sourceAgentId` must be valid EVM addresses
- `agentId` must differ from `sourceAgentId` (no self-attestation)
- `proof.signer` must match `sourceAgentId`
- EIP-712 signature must be valid
- `timestamp` must be ISO 8601
- `data.type` must match `eventType`
- Rate limit: 100 events per agent per hour

**Response 201 (accepted):**
```json
{
  "accepted": true,
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "attestation": {
    "signature": "0x...",
    "signer": "0xOracleAddress",
    "eventId": "550e8400-e29b-41d4-a716-446655440000",
    "agentId": "0xSubjectAgentAddress",
    "timestamp": "2025-01-15T09:00:05.000Z"
  }
}
```

**Response 200 (duplicate):**
```json
{
  "accepted": true,
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "duplicate": true,
  "attestation": null
}
```

**Error responses:**

| Status | Body |
|--------|------|
| 400    | `{ "error": "Invalid event data", "details": [...] }` |
| 400    | `{ "error": "Invalid EVM address format" }` |
| 400    | `{ "error": "Proof signer does not match sourceAgentId" }` |
| 400    | `{ "error": "Invalid event signature" }` |
| 402    | Payment required |
| 403    | `{ "error": "Self-attestation is not allowed" }` |
| 429    | `{ "error": "Rate limit exceeded for this agent" }` |
| 500    | `{ "error": "Internal server error" }` |

## Event Type Reference

### transaction_completed
```json
{
  "type": "transaction_completed",
  "completedSuccessfully": true,
  "valueUsd": 50.00,
  "durationMs": 12000
}
```

### sla_verified
```json
{
  "type": "sla_verified",
  "metSla": true,
  "slaType": "response_time",
  "measuredValue": 150,
  "threshold": 200
}
```

### arbitration_result
```json
{
  "type": "arbitration_result",
  "outcome": "agent_favored",
  "valueUsd": 100.00,
  "arbitrator": "0xArbitratorAddress"
}
```

### slash
```json
{
  "type": "slash",
  "severity": "minor",
  "reason": "Late delivery by 2 hours",
  "slasher": "0xSlasherAddress"
}
```

### attestation
```json
{
  "type": "attestation",
  "category": "reliability",
  "confidence": 0.85,
  "comment": "Consistently delivers on time"
}
```
