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

## Architecture

- **Storage**: SQLite with WAL mode, append-only event log
- **Math**: Exponential decay with Bayesian averaging
- **Crypto**: EIP-712 typed data signatures via viem
- **Payments**: x402 protocol with Coinbase facilitator
- **Network**: Base Sepolia (configurable)

## License

MIT
