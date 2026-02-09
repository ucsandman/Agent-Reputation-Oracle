# Agent Reputation Oracle

## What This Repo Does

Protocol-native Agent Reputation Oracle for autonomous AI agents on the x402 payment protocol. Agents query, update, and verify cryptographic reputation signals via signed requests and x402 micropayments.

## Architecture

- **Runtime**: Node.js + Express.js + TypeScript (strict mode)
- **Payment**: x402 protocol via `@x402/express` middleware
- **Storage**: SQLite + WAL mode (append-only event log)
- **Network**: Base Sepolia (`eip155:84532`), configurable
- **Identity**: EVM wallet addresses

## Major Components

| Component | Path | Purpose |
|-----------|------|---------|
| Types | `src/types/` | Shared TypeScript interfaces |
| Models | `src/models/` | Zod validation schemas |
| Storage | `src/storage/` | EventLog (SQLite), ReputationCache |
| Reputation | `src/reputation/` | Decay, scoring math, engine |
| Crypto | `src/crypto/` | EIP-712 signing, attestations, receipts |
| x402 | `src/x402/` | Payment middleware, pricing |
| Routes | `src/routes/` | API endpoints |
| Server | `src/server.ts` | Entry point |

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (tsx watch)
npm run build        # Compile TypeScript
npm start            # Run compiled server
npm test             # Run tests
npm run test:watch   # Watch mode tests
npm run lint         # TypeScript type check
npm run typecheck    # TypeScript type check
npm run seed         # Seed database with sample data
npm run replay       # Replay event log
```

## Configuration

All config via environment variables. See `.env.example`.

## Data Flow

1. Agent submits signed reputation event via `POST /reputation/event` (pays x402)
2. Oracle validates signature, appends to event log, invalidates cache
3. Agent queries reputation via `GET /reputation/:agentId` (pays x402)
4. Oracle computes vector from events with exponential decay, returns signed receipt
