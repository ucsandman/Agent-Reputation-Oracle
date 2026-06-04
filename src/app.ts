import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import express from 'express';
import { AttestationService } from './crypto/attestation.js';
import { ReceiptService } from './crypto/receipt.js';
import { setChainId } from './crypto/signing.js';
import { createReputationRouter } from './routes/reputation.js';
import { createEventsRouter } from './routes/events.js';
import { ReputationEngine } from './reputation/engine.js';
import { ReputationCache } from './storage/cache.js';
import { EventLog } from './storage/event-log.js';
import { createPaymentMiddleware } from './x402/middleware.js';
import type { AppConfig } from './types/index.js';

export interface OracleApp {
  app: express.Express;
  eventLog: EventLog;
  cache: ReputationCache;
  engine: ReputationEngine;
  attestationService: AttestationService;
  receiptService: ReceiptService;
  close: () => void;
}

export function createOracleApp(config: AppConfig): OracleApp {
  const chainId = parseInt(config.x402.network.split(':')[1] ?? '84532', 10);
  setChainId(chainId);

  if (config.db.path !== ':memory:') {
    const dbDir = dirname(config.db.path);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
  }

  const eventLog = new EventLog(config.db.path);
  const cache = new ReputationCache(eventLog.getDatabase());
  const engine = new ReputationEngine();
  const attestationService = new AttestationService(config.server.privateKey);
  const receiptService = new ReceiptService(config.server.privateKey);

  const app = express();
  app.use(express.json());

  const healthHandler: express.RequestHandler = (_req, res) => {
    res.json({
      status: 'ok',
      oracle: attestationService.oracleAddress,
      network: config.x402.network,
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/health', healthHandler);
  app.get('/v1/health', healthHandler);

  const reputationRouter = createReputationRouter(eventLog, cache, engine, receiptService);
  const eventsRouter = createEventsRouter(eventLog, cache, attestationService, config);

  if (config.nodeEnv === 'production') {
    app.use(createPaymentMiddleware(config));
  } else if (config.nodeEnv === 'development') {
    console.log('Development mode: x402 payment middleware disabled');
  }

  app.use('/v1/reputation/event', eventsRouter);
  app.use('/v1/reputation', reputationRouter);

  // Backward-compatible aliases for pre-versioned clients.
  app.use('/reputation/event', eventsRouter);
  app.use('/reputation', reputationRouter);

  return {
    app,
    eventLog,
    cache,
    engine,
    attestationService,
    receiptService,
    close: () => eventLog.close(),
  };
}
