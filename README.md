# Agent Reputation Oracle

Protocol-native reputation oracle for autonomous AI agents on the [x402 payment protocol](https://x402.org).

## Prerequisites

- Node.js >= 20
- npm >= 10
- An EVM wallet (private key for oracle signing)
- Base Sepolia USDC for testing

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

## API Endpoints

All endpoints (except `/health`) require x402 payment.

| Method | Path | Price | Description |
|--------|------|-------|-------------|
| GET | `/health` | Free | Health check |
| GET | `/reputation/:agentId` | $0.001 | Full reputation vector + signed receipt |
| GET | `/reputation/:agentId/summary` | $0.0005 | Lightweight reputation summary |
| GET | `/reputation/:agentId/attestations` | $0.001 | Paginated event history |
| POST | `/reputation/event` | $0.01 | Submit signed reputation event |

## SDK

A TypeScript client SDK is available at [`sdk/`](./sdk/). See [`sdk/README.md`](./sdk/README.md) for full documentation.

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

## Architecture

- **Storage**: SQLite with WAL mode, append-only event log
- **Math**: Exponential decay with Bayesian averaging
- **Crypto**: EIP-712 typed data signatures via viem
- **Payments**: x402 protocol with Coinbase facilitator
- **Network**: Base Sepolia (configurable)

## License

MIT
