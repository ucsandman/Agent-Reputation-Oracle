# Agent Reputation Oracle - Implementation Tasks

## Phase 1: Project Scaffolding
- [x] package.json with all deps/scripts
- [x] tsconfig.json strict mode
- [x] vitest.config.ts
- [x] .env.example
- [x] .gitignore
- [x] Directory structure
- [x] CLAUDE.md
- [x] README.md
- [x] npm install succeeds
- [x] tsc --noEmit passes

## Phase 2: Core Types & Storage
- [x] src/types/index.ts
- [x] src/models/event.ts
- [x] src/storage/migrations.ts
- [x] src/storage/event-log.ts
- [x] src/storage/cache.ts

## Phase 3: Reputation Math Engine
- [x] src/reputation/decay.ts
- [x] src/reputation/math.ts
- [x] src/reputation/engine.ts

## Phase 4: Crypto Layer
- [x] src/crypto/signing.ts
- [x] src/crypto/attestation.ts
- [x] src/crypto/receipt.ts

## Phase 5: API + x402
- [x] src/config.ts
- [x] src/x402/middleware.ts
- [x] src/x402/pricing.ts
- [x] src/routes/reputation.ts
- [x] src/routes/events.ts
- [x] src/server.ts

## Phase 6: Security Hardening
- [x] Rate limiting (events.ts line 67-71)
- [x] Collusion detection (engine.ts)
- [x] Self-attestation rejection (events.ts line 46-49)
- [x] Input validation (Zod schemas)
- [x] Address checksumming (viem.getAddress)
- [x] Prepared statements (all SQL)

## Phase 7: Documentation
- [x] docs/architecture.md
- [x] docs/reputation-math.md
- [x] docs/api-spec.md
- [x] docs/threat-model.md
- [x] docs/agent-usage.md

## Phase 8: Tests
- [x] tests/reputation/decay.test.ts (11 tests)
- [x] tests/reputation/math.test.ts (17 tests)
- [x] tests/reputation/engine.test.ts (7 tests)
- [x] tests/storage/event-log.test.ts (12 tests)
- [x] tests/storage/cache.test.ts (7 tests)
- [x] tests/crypto/signing.test.ts (6 tests)
- [x] tests/crypto/receipt.test.ts (4 tests)
- [x] tests/api/reputation.test.ts (8 tests)
- [x] tests/api/events.test.ts (8 tests)

## Verification
- [x] npm install succeeds
- [x] tsc --noEmit passes (0 errors)
- [x] npm test passes (80/80 tests, <1s)
- [x] .env in .gitignore
- [x] No secrets committed
