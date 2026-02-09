import { Router } from 'express';
import { getAddress } from 'viem';
import { ReputationEngine } from '../reputation/engine.js';
import { EventLog } from '../storage/event-log.js';
import { ReputationCache } from '../storage/cache.js';
import { ReceiptService } from '../crypto/receipt.js';
import { hashReputationVector } from '../crypto/signing.js';
import { AttestationQuerySchema } from '../models/event.js';
import type { EvmAddress, EventQueryOptions } from '../types/index.js';

export function createReputationRouter(
  eventLog: EventLog,
  cache: ReputationCache,
  engine: ReputationEngine,
  receiptService: ReceiptService,
): Router {
  const router = Router();

  // GET /:agentId/summary — Lightweight summary (no receipt)
  router.get('/:agentId/summary', (req, res) => {
    void (async () => {
      try {
        const agentId = validateAddress(req.params['agentId']);
        if (!agentId) {
          res.status(400).json({ error: 'Invalid EVM address' });
          return;
        }

        const agent = eventLog.getAgent(agentId);
        if (!agent) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }

        const vector = getOrComputeVector(agentId, eventLog, cache, engine);
        const summary = engine.computeSummary(agentId, vector);

        res.json(summary);
      } catch (err) {
        console.error('Error fetching summary:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  // GET /:agentId/attestations — Paginated event history
  router.get('/:agentId/attestations', (req, res) => {
    try {
      const agentId = validateAddress(req.params['agentId']);
      if (!agentId) {
        res.status(400).json({ error: 'Invalid EVM address' });
        return;
      }

      const agent = eventLog.getAgent(agentId);
      if (!agent) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const queryResult = AttestationQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        res.status(400).json({ error: 'Invalid query parameters', details: queryResult.error.issues });
        return;
      }

      const query = queryResult.data;
      const options: EventQueryOptions = {
        limit: query.limit,
        offset: query.offset,
        eventType: query.type,
      };

      const events = eventLog.getEventsByAgent(agentId, options);

      res.json({
        agentId,
        events,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          count: events.length,
        },
      });
    } catch (err) {
      console.error('Error fetching attestations:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /:agentId — Full reputation vector + signed receipt
  router.get('/:agentId', (req, res) => {
    void (async () => {
      try {
        const agentId = validateAddress(req.params['agentId']);
        if (!agentId) {
          res.status(400).json({ error: 'Invalid EVM address' });
          return;
        }

        const agent = eventLog.getAgent(agentId);
        if (!agent) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }

        const vector = getOrComputeVector(agentId, eventLog, cache, engine);
        const receipt = await receiptService.signReputationReceipt(agentId, vector);

        res.json({
          agentId,
          vector,
          receipt,
        });
      } catch (err) {
        console.error('Error fetching reputation:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  return router;
}

function validateAddress(address: string | undefined): EvmAddress | null {
  if (!address) return null;
  try {
    return getAddress(address) as EvmAddress;
  } catch {
    return null;
  }
}

function getOrComputeVector(
  agentId: EvmAddress,
  eventLog: EventLog,
  cache: ReputationCache,
  engine: ReputationEngine,
) {
  if (!cache.isStale(agentId)) {
    const cached = cache.get(agentId);
    if (cached) return cached.vector;
  }

  const events = eventLog.getEventsByAgent(agentId);
  const now = new Date();
  const vector = engine.computeVector(events, now);
  const vectorHash = hashReputationVector(vector);
  cache.set(agentId, vector, vectorHash);

  return vector;
}
