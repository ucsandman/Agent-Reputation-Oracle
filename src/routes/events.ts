import { Router } from 'express';
import { getAddress } from 'viem';
import { ReputationEventSchema } from '../models/event.js';
import { verifyEventSignature } from '../crypto/signing.js';
import { EventLog } from '../storage/event-log.js';
import { ReputationCache } from '../storage/cache.js';
import { AttestationService } from '../crypto/attestation.js';
import type { AppConfig, EvmAddress } from '../types/index.js';

export function createEventsRouter(
  eventLog: EventLog,
  cache: ReputationCache,
  attestationService: AttestationService,
  config: AppConfig,
): Router {
  const router = Router();

  router.post('/', (req, res) => {
    void (async () => {
      try {
        // 1. Parse + validate with Zod
        const parseResult = ReputationEventSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: 'Invalid event data',
            details: parseResult.error.issues,
          });
          return;
        }

        const event = parseResult.data;

        // Normalize addresses
        let agentId: EvmAddress;
        let sourceAgentId: EvmAddress;
        try {
          agentId = getAddress(event.agentId) as EvmAddress;
          sourceAgentId = getAddress(event.sourceAgentId) as EvmAddress;
        } catch {
          res.status(400).json({ error: 'Invalid EVM address format' });
          return;
        }

        // 2. Reject self-attestation
        if (agentId === sourceAgentId) {
          res.status(403).json({ error: 'Self-attestation is not allowed' });
          return;
        }

        // 3. Verify EIP-712 signature (proof.signer must match sourceAgentId)
        const signerAddress = getAddress(event.proof.signer) as EvmAddress;
        if (signerAddress !== sourceAgentId) {
          res.status(400).json({ error: 'Proof signer does not match sourceAgentId' });
          return;
        }

        const signatureValid = await verifyEventSignature({
          ...event,
          agentId,
          sourceAgentId,
          proof: { ...event.proof, signer: signerAddress },
        });

        if (!signatureValid) {
          res.status(400).json({ error: 'Invalid event signature' });
          return;
        }

        // 4. Rate limiting: count events per agent in last hour
        const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
        const recentCount = eventLog.countEventsByAgentSince(agentId, oneHourAgo);
        if (recentCount >= config.security.maxEventsPerAgentPerHour) {
          res.status(429).json({ error: 'Rate limit exceeded for this agent' });
          return;
        }

        // 5. Check idempotency (existing event ID → return 200 with duplicate: true)
        const existing = eventLog.getEventById(event.id);
        if (existing) {
          res.status(200).json({
            accepted: true,
            eventId: event.id,
            duplicate: true,
            attestation: null,
          });
          return;
        }

        // 6. Ensure agent exists
        eventLog.ensureAgent(agentId);
        eventLog.ensureAgent(sourceAgentId);

        // 7. Append to event log
        eventLog.appendEvent({
          ...event,
          agentId,
          sourceAgentId,
          proof: { ...event.proof, signer: signerAddress },
        });

        // 8. Invalidate reputation cache
        cache.invalidate(agentId);

        // 9. Create acceptance attestation
        const attestation = await attestationService.createEventAcceptanceAttestation(
          event.id,
          agentId,
        );

        // 10. Return 201
        res.status(201).json({
          accepted: true,
          eventId: event.id,
          attestation,
        });
      } catch (err) {
        console.error('Error processing event:', err);
        res.status(500).json({ error: 'Internal server error' });
      }
    })();
  });

  return router;
}
