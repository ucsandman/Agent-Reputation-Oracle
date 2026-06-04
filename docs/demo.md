# Demo Walkthrough

Run:

```bash
npm run demo
```

The demo is intentionally self-contained. It uses an in-memory SQLite database,
test private keys, and the real route handlers without x402 payment middleware.
No Base Sepolia USDC, facilitator, or long-running server is required.

## What It Does

1. Creates a subject agent address and a separate attester agent address.
2. Signs three EIP-712 reputation events from the attester:
   - `transaction_completed`
   - `sla_verified`
   - `attestation`
3. Submits each event through `POST /v1/reputation/event`.
4. Queries `GET /v1/reputation/:agentId`.
5. Verifies the returned EIP-712 reputation receipt with the oracle signer.

## Expected Output

You should see output like:

```text
Agent Reputation Oracle demo
Subject agent:  0x1111111111111111111111111111111111111111
Attester agent: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Oracle signer:  0x70997970C51812dc3A010C7d01b50e0d17dc79C8
Accepted transaction_completed: <event-id>
Accepted sla_verified: <event-id>
Accepted attestation: <event-id>

Computed reputation vector
{
  "reliabilityScore": 0.5083,
  "completionRate": 0.7075,
  "disputeRate": 0.0491,
  "slaAdherence": 0.8066,
  "volumeWeight": 1.3862,
  "totalEvents": 3,
  "lastEventTimestamp": "...",
  "computedAt": "..."
}

Receipt signature valid: true
Vector hash: 0x...
```

The exact scores can shift slightly because the decay calculation uses the
current timestamp, but the key checks are:

- All three events are accepted.
- `totalEvents` is `3`.
- `Receipt signature valid` is `true`.
- The receipt includes a `vectorHash` that binds the signed receipt to the
  returned reputation vector.

## Why This Demo Matters

This exercises the product contract end to end:

- Agent-signed reputation input
- Validation and self-attestation rejection logic
- Append-only event storage
- Reputation computation
- Oracle-signed receipt generation
- Independent receipt verification

Production deployments add x402 payment enforcement around the same route
handlers.
