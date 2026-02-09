import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import express from 'express';
import { loadConfig } from './config.js';
import { EventLog } from './storage/event-log.js';
import { ReputationCache } from './storage/cache.js';
import { ReputationEngine } from './reputation/engine.js';
import { AttestationService } from './crypto/attestation.js';
import { ReceiptService } from './crypto/receipt.js';
import { setChainId } from './crypto/signing.js';
import { createPaymentMiddleware } from './x402/middleware.js';
import { createReputationRouter } from './routes/reputation.js';
import { createEventsRouter } from './routes/events.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const config = loadConfig();

// Set EIP-712 chain ID from network config (e.g. "eip155:8453" → 8453)
const chainId = parseInt(config.x402.network.split(':')[1] ?? '84532', 10);
setChainId(chainId);

// Ensure data directory exists
const dbDir = dirname(config.db.path);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

// Initialize storage
const eventLog = new EventLog(config.db.path);
const cache = new ReputationCache(eventLog.getDatabase());

// Initialize services
const engine = new ReputationEngine();
const attestationService = new AttestationService(config.server.privateKey);
const receiptService = new ReceiptService(config.server.privateKey);

// Create Express app
const app = express();
app.use(express.json());

// Health check — not behind paywall
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    oracle: attestationService.oracleAddress,
    network: config.x402.network,
    timestamp: new Date().toISOString(),
  });
});

// Mount routes
const reputationRouter = createReputationRouter(eventLog, cache, engine, receiptService);
const eventsRouter = createEventsRouter(eventLog, cache, attestationService, config);

if (config.nodeEnv === 'production') {
  // x402 payment middleware (BEFORE route handlers) — production only
  app.use(createPaymentMiddleware(config));
  app.use('/reputation', reputationRouter);
  app.use('/reputation/event', eventsRouter);
} else {
  // Development mode: routes without payment gating
  console.log('Development mode: x402 payment middleware disabled');
  app.use('/reputation/event', eventsRouter);
  app.use('/reputation', reputationRouter);
}

// Start server
app.listen(config.port, () => {
  console.log(`Agent Reputation Oracle running on port ${config.port}`);
  console.log(`Oracle address: ${attestationService.oracleAddress}`);
  console.log(`Network: ${config.x402.network}`);
  console.log(`Facilitator: ${config.x402.facilitatorUrl}`);
});

export { app };
