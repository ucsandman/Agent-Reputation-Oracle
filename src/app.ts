import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import express from 'express';
import { getAddress } from 'viem';
import { AttestationService } from './crypto/attestation.js';
import { ReceiptService } from './crypto/receipt.js';
import { setChainId } from './crypto/signing.js';
import { createReputationRouter } from './routes/reputation.js';
import { createEventsRouter } from './routes/events.js';
import { createExplorerRouter } from './routes/explorer.js';
import { ReputationEngine } from './reputation/engine.js';
import { ReputationCache } from './storage/cache.js';
import { EventLog } from './storage/event-log.js';
import { createPaymentMiddleware } from './x402/middleware.js';
import type { AppConfig, EvmAddress } from './types/index.js';

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
  app.set('trust proxy', 1);
  app.use(express.json());

  // Public-surface floor: humans and crawlers land on the explorer, the JSON API stays out of the index.
  const baseUrl = (req: express.Request): string => `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  app.get('/', (_req, res) => res.redirect(302, '/explorer'));
  app.use(['/v1', '/reputation', '/health'], (_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex');
    next();
  });
  app.get('/robots.txt', (req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /explorer\nDisallow: /v1/\nDisallow: /reputation/\nDisallow: /health\nSitemap: ${baseUrl(req)}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (req, res) => {
    const base = baseUrl(req);
    const agents = eventLog.getDatabase()
      .prepare('SELECT agent_id, MAX(timestamp) AS last_ts FROM events GROUP BY agent_id ORDER BY last_ts DESC LIMIT 5000')
      .all() as Array<{ agent_id: string; last_ts: string }>;
    const urls = [`<url><loc>${base}/explorer</loc></url>`]
      .concat(agents.map((a) => `<url><loc>${base}/explorer/${a.agent_id}</loc><lastmod>${a.last_ts.slice(0, 10)}</lastmod></url>`));
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  });
  app.get('/llms.txt', (req, res) => {
    const base = baseUrl(req);
    res.type('text/plain').send(`# Agent Reputation Oracle

> Reputation scores for autonomous AI agents, computed from signed events (EIP-712 attestations, x402 transactions, ERC-8004 feedback) with attester weighting and 90-day decay. Open source, independently recomputable.

## Free endpoints
- ${base}/explorer : human explorer, search any agent address
- ${base}/v1/events?after=0&limit=500 : raw append-order event log with original signatures, page with nextAfter
- ${base}/v1/agents/{address} : agent record, ERC-8004 token and agentURI change history
- ${base}/v1/health : oracle signing address and network

## Paid endpoints (x402, ${config.x402.network})
- GET /v1/reputation/{address} : full vector with signed receipt
- GET /v1/reputation/{address}/summary
- GET /v1/reputation/{address}/attestations

## Docs
- https://github.com/ucsandman/Agent-Reputation-Oracle
- https://github.com/ucsandman/Agent-Reputation-Oracle/blob/main/docs/api-spec.md
`);
  });

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
  app.use('/explorer', createExplorerRouter(eventLog, cache, engine));

  // Free, unsigned export of the raw log so anyone can recompute scores without trusting the oracle key.
  app.get('/v1/events', (req, res) => {
    const after = Math.max(0, parseInt(String(req.query['after'] ?? '0'), 10) || 0);
    const limit = Math.min(1000, Math.max(1, parseInt(String(req.query['limit'] ?? '500'), 10) || 500));
    const events = eventLog.getEventsAfter(after, limit);
    const last = events[events.length - 1];
    res.json({ events, nextAfter: last ? last.seq : after, limit });
  });

  // Free agent record: identity metadata (ERC-8004 token, owner at import, agentURI change history).
  app.get('/v1/agents/:agentId', (req, res) => {
    let agentId: EvmAddress;
    try {
      agentId = getAddress(String(req.params['agentId'])) as EvmAddress;
    } catch {
      res.status(400).json({ error: 'Invalid EVM address format' });
      return;
    }
    const agent = eventLog.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  });

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
