import {
  computeReliability,
  computeCompletionRate,
  computeDisputeRate,
  computeSlaAdherence,
  computeVolumeWeight,
} from './math.js';
import { isWithinActiveWindow, type DecayConfig, DEFAULT_DECAY_CONFIG } from './decay.js';
import type { ReputationEvent, ReputationVector, ReputationSummary, EvmAddress } from '../types/index.js';

// ─── Collusion Detection ───

interface CollusionWeights {
  attesterDistribution: Map<string, number>;
  totalEvents: number;
}

function computeCollusionDiscount(distribution: CollusionWeights): number {
  if (distribution.totalEvents === 0) return 1.0;

  let maxRatio = 0;
  for (const count of distribution.attesterDistribution.values()) {
    const ratio = count / distribution.totalEvents;
    if (ratio > maxRatio) maxRatio = ratio;
  }

  if (maxRatio > 0.8) return 0.1;
  if (maxRatio > 0.5) return 0.5;
  return 1.0;
}

function getAttesterDistribution(events: ReputationEvent[]): CollusionWeights {
  const distribution = new Map<string, number>();
  for (const event of events) {
    const current = distribution.get(event.sourceAgentId) ?? 0;
    distribution.set(event.sourceAgentId, current + 1);
  }
  return { attesterDistribution: distribution, totalEvents: events.length };
}

// ─── Reputation Engine ───

export class ReputationEngine {
  private decayConfig: DecayConfig;

  constructor(decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG) {
    this.decayConfig = decayConfig;
  }

  computeVector(events: ReputationEvent[], now: Date = new Date()): ReputationVector {
    const collusionDiscount = computeCollusionDiscount(getAttesterDistribution(events));

    // Apply collusion discount by reducing event weights conceptually.
    // We pass all events and let the math functions apply decay.
    // Collusion discount is applied post-computation.
    const rawReliability = computeReliability(events, now, this.decayConfig);
    const rawCompletion = computeCompletionRate(events, now, this.decayConfig);
    const rawDispute = computeDisputeRate(events, now, this.decayConfig);
    const rawSla = computeSlaAdherence(events, now, this.decayConfig);
    const volumeWeight = computeVolumeWeight(events, now, this.decayConfig);

    // Apply collusion discount: pull scores toward their priors
    const reliability = applyDiscount(rawReliability, 0.5, collusionDiscount);
    const completionRate = applyDiscount(rawCompletion, 0.7, collusionDiscount);
    const disputeRate = applyDiscount(rawDispute, 0.05, collusionDiscount);
    const slaAdherence = applyDiscount(rawSla, 0.8, collusionDiscount);

    const lastEvent = events.length > 0
      ? events.reduce((latest, e) => e.timestamp > latest.timestamp ? e : latest, events[0]!)
      : null;

    return {
      reliabilityScore: reliability,
      completionRate,
      disputeRate,
      slaAdherence,
      volumeWeight,
      totalEvents: events.length,
      lastEventTimestamp: lastEvent?.timestamp ?? '',
      computedAt: now.toISOString(),
    };
  }

  computeSummary(agentId: EvmAddress, vector: ReputationVector): ReputationSummary {
    return {
      agentId,
      reliabilityScore: vector.reliabilityScore,
      completionRate: vector.completionRate,
      disputeRate: vector.disputeRate,
      slaAdherence: vector.slaAdherence,
      volumeWeight: vector.volumeWeight,
      totalEvents: vector.totalEvents,
      isActive: this.isActive(vector),
      confidence: this.computeConfidence(vector),
      lastEventTimestamp: vector.lastEventTimestamp,
      computedAt: vector.computedAt,
    };
  }

  isActive(vector: ReputationVector): boolean {
    if (!vector.lastEventTimestamp) return false;
    return isWithinActiveWindow(vector.lastEventTimestamp, new Date(), this.decayConfig);
  }

  computeConfidence(vector: ReputationVector): number {
    // confidence = 1 - e^(-0.1 * volumeWeight), range [0,1)
    return 1 - Math.exp(-0.1 * vector.volumeWeight);
  }
}

/**
 * Apply collusion discount by pulling score toward prior.
 * At discount=1.0 (no collusion), score is unchanged.
 * At discount=0.1 (heavy collusion), score moves 90% toward prior.
 */
function applyDiscount(score: number, prior: number, discount: number): number {
  return prior + (score - prior) * discount;
}
