# Agent Reputation Oracle

Protocol-native reputation for autonomous AI agents.

Agent Reputation Oracle lets agents submit signed reputation events, query an
agent's computed reputation vector, and verify oracle-signed receipts. The
service is designed for x402-native agent economies where reputation reads and
writes can be paid for directly by the calling agent.

## Why This Exists

Autonomous agents need a way to decide whether another agent is worth trusting
before they delegate work, pay for a task, or accept an offer. Wallet addresses
give agents identity, but not history. This oracle turns signed interaction
events into portable reputation signals:

- **Signed inputs:** attesters sign EIP-712 reputation events.
- **Append-only history:** accepted events are stored in SQLite with WAL mode.
- **Deterministic scoring:** reputation is recomputed from the event log using
  decay, Bayesian priors, and volume weighting.
- **Verifiable outputs:** every full reputation query returns an EIP-712 signed
  receipt containing a hash of the computed vector.
- **x402-native access:** paid endpoints can require x402 micropayments in
  production.

## Prerequisites

- Node.js >= 20
- npm >= 10
- An EVM private key for production oracle signing
- Base Sepolia USDC only when testing production-style x402 payments

## Quick Start

```bash
# Clone
git clone git@github.com:ucsandman/Agent-Reputation-Oracle.git
cd Agent-Reputation-Oracle

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your wallet private key and pay-to address

# Run dev server
npm run dev

# Run tests
npm test
```

Run the local demo:

```bash
npm run demo
```

The demo creates an in-memory oracle, submits signed events from one test agent
about another, queries the reputation vector, and verifies the signed receipt.
It does not require testnet USDC or a live x402 facilitator.

## API Endpoints

In production, all endpoints except `/v1/health` require x402 payment. In
development and test mode, payment middleware is disabled so the API can be
exercised locally.

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/v1/health` | Free | Health check |
| GET | `/v1/reputation/:agentId` | $0.001 | Full reputation vector + signed receipt |
| GET | `/v1/reputation/:agentId/summary` | $0.0005 | Lightweight reputation summary |
| GET | `/v1/reputation/:agentId/attestations` | $0.001 | Paginated event history |
| POST | `/v1/reputation/event` | $0.01 | Submit signed reputation event |

Full endpoint details are in [docs/api-spec.md](./docs/api-spec.md).
Unversioned routes are still mounted as backward-compatible aliases.

## SDK

A TypeScript client SDK is available at [`sdk/`](./sdk/). See
[`sdk/README.md`](./sdk/README.md) for full documentation.

```bash
cd sdk && npm install
```

```typescript
import { ReputationOracleClient } from '@agent-reputation-oracle/sdk';

const client = new ReputationOracleClient({
  oracleUrl: 'http://localhost:3402',
  privateKey: '0xYOUR_KEY', // required for submitEvent
});

// Query reputation
const { vector, receipt } = await client.getReputation('0xAGENT');

// Submit event
await client.submitEvent('0xAGENT', {
  type: 'transaction_completed',
  completedSuccessfully: true,
  valueUsd: 50,
  durationMs: 3000,
});

// Verify receipt
const valid = await client.verifyReceipt(receipt);
```

## Trust Model

The oracle is a signed data service, not a fully decentralized reputation
protocol. Consumers should understand three layers:

1. **Event authenticity:** accepted events must be signed by the attesting
   agent. The oracle rejects self-attestation and signatures where
   `proof.signer` does not match `sourceAgentId`.
2. **Score reproducibility:** reputation vectors are deterministic outputs of
   the append-only event log and scoring algorithm.
3. **Receipt authenticity:** full reputation responses include a signed receipt
   from the oracle. Consumers can verify the receipt signature and compare the
   `oracleAddress` against `/v1/health`.

The current oracle still requires trusting the operator to preserve the event
log, run the published scoring code, and protect the signing key. See
[docs/threat-model.md](./docs/threat-model.md) for residual risks and planned
hardening paths such as graph-based collusion detection, key rotation, backups,
and eventual multi-signer or on-chain anchoring.

## Deployment

Build and run locally with Docker:

```bash
docker compose up --build
```

The compose setup runs the API in production mode, stores SQLite data in a
named volume, and exposes `/health` for container health checks.

## Architecture

- **Storage**: SQLite with WAL mode, append-only event log
- **Math**: Exponential decay with Bayesian averaging
- **Crypto**: EIP-712 typed data signatures via viem
- **Payments**: x402 protocol with Coinbase facilitator
- **Network**: Base Sepolia (configurable)

More detail:

- [Architecture](./docs/architecture.md)
- [Reputation math](./docs/reputation-math.md)
- [Agent usage guide](./docs/agent-usage.md)
- [Demo walkthrough](./docs/demo.md)

## License

MIT
