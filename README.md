# Agent Reputation Oracle

A reputation service for AI agents, built for a world where agents hire,
pay, and delegate to other agents without a human checking first.

Other agents submit signed events about an agent: a job completed, an SLA
met, an arbitration result, a slash, or a general attestation. The oracle
stores every event in an append-only log and computes five decayed
reputation scores plus one composite 0-100 score, weighted so that no single
attester or fresh batch of sock-puppet wallets can move the needle much.
Every full query returns an EIP-712 signed receipt you can verify offline,
independent of the oracle. Reads cost a fraction of a cent in x402
micropayments; submitting events is free by default, to get real data
flowing before charging for it. A browser explorer at `/explorer` lets a
human look up any agent's score, and an ERC-8004 importer pulls in on-chain
agent feedback as another data source. Not deployed anywhere yet, this is a
working local implementation.

## Quickstart

```bash
git clone git@github.com:ucsandman/Agent-Reputation-Oracle.git && cd Agent-Reputation-Oracle
npm install
cp .env.example .env   # add your wallet private key and pay-to address
npm run dev
npm run demo            # separate terminal: submits events, queries, verifies a receipt
```

## What You Get Back

```bash
curl http://localhost:3402/v1/reputation/0x1234567890abcdef1234567890abcdef12345678
```

```json
{
  "agentId": "0x1234567890abcdef1234567890abcdef12345678",
  "vector": {
    "reliabilityScore": 0.643,
    "completionRate": 0.820,
    "disputeRate": 0.036,
    "slaAdherence": 0.867,
    "volumeWeight": 1.386,
    "compositeScore": 54,
    "totalEvents": 3,
    "lastEventTimestamp": "2025-01-15T09:00:00.000Z",
    "computedAt": "2025-01-15T10:30:00.000Z"
  },
  "receipt": {
    "agentId": "0x1234567890abcdef1234567890abcdef12345678",
    "vectorHash": "0xabc123...",
    "signature": "0xdef456...",
    "timestamp": "2025-01-15T10:30:00.000Z",
    "oracleAddress": "0xOracleAddress"
  }
}
```

`compositeScore` blends the five underlying scores into one 0-100 number,
pulled toward 50 when there isn't enough history to be confident about it.
54 here reflects low confidence from only 3 events, not a mediocre agent.
The `receipt` lets any caller confirm the oracle actually returned this
exact vector, without trusting the oracle operator at read time. See
[docs/api-spec.md](./docs/api-spec.md) for every field.

## Why Sybil-Resistance and Receipts Matter

ERC-8004, the emerging on-chain standard for agent identity, reached
Ethereum mainnet in January 2026 with more than 45,000 agents registered.
A study of its Reputation Registry found that 59 to 91 percent of feedback,
depending on the chain, looked like coordinated Sybil behavior: agents or
their owners writing themselves fake reviews. Raw on-chain feedback is not
a trust signal by itself.

This oracle weights every event by the submitting agent's own standing and
caps how much any single attester can move a score, so a batch of fresh
wallets barely changes the result. Scores are also fully reproducible: given
the same event log, anyone gets the same numbers, and the signed receipt
proves the oracle didn't quietly change them for one caller.

Full documentation lives in [docs/](./docs/), including the
[reputation math](./docs/reputation-math.md), the
[threat model](./docs/threat-model.md), and the
[ERC-8004 importer](./docs/erc8004.md).

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
| POST | `/v1/reputation/event` | Free by default | Submit signed reputation event (`PRICE_EVENT_SUBMIT`, default `0`) |
| GET | `/v1/events?after=<seq>&limit=<n>` | Free | Raw append-order export of the whole event log, with each attester's original signature, for independent recomputation |
| GET | `/explorer` and `/explorer/:agentId` | Free | Human-readable browser view of an agent's score and event history |

Full endpoint details are in [docs/api-spec.md](./docs/api-spec.md).
Unversioned routes are still mounted as backward-compatible aliases.

## ERC-8004 Importer

`npm run index:erc8004` reads `NewFeedback` events from an ERC-8004
Reputation Registry on chain and appends them to the event log as
attestations, so the oracle has real data before any agent submits a single
event through the API. It's read-only, idempotent, and resumes from a
stored cursor on re-run. Imported agents are keyed on the ERC-8004 token id,
not the owner wallet, so reputation survives the owner rotating keys. See [docs/erc8004.md](./docs/erc8004.md) for
supported chains, contract addresses, and how on-chain values map to event
fields.

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
4. **Independent recomputation:** `GET /v1/events` is a free, paged export of
   the raw log with every attester signature intact. A consumer that does not
   want to trust the oracle key can pull the log, verify each event's EIP-712
   signature, and run `ReputationEngine` locally to get the same vector.

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
- **Math**: Exponential decay with Bayesian averaging, attester-weighted
  composite 0-100 score
- **Crypto**: EIP-712 typed data signatures via viem
- **Payments**: x402 protocol with Coinbase facilitator
- **Network**: Base Sepolia (configurable)
- **On-chain data**: ERC-8004 Reputation Registry importer
- **Explorer**: Server-rendered browser UI at `/explorer`

More detail:

- [Architecture](./docs/architecture.md)
- [Reputation math](./docs/reputation-math.md)
- [Agent usage guide](./docs/agent-usage.md)
- [Demo walkthrough](./docs/demo.md)
- [ERC-8004 importer](./docs/erc8004.md)
- [Threat model](./docs/threat-model.md)

## License

MIT
