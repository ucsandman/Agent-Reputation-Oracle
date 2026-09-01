import {
  computeReliability,
  computeCompletionRate,
  computeDisputeRate,
  computeSlaAdherence,
  computeVolumeWeight,
} from './math.js';
import { isWithinActiveWindow, type DecayConfig, DEFAULT_DECAY_CONFIG } from './decay.js';
import type { ReputationEvent, ReputationVector, ReputationSummary, EvmAddress } from '../types/index.js';

// ─── Attester Weighting ───

// A brand-new wallet still counts a little, but a well-regarded attester counts
// up to 10x more. Sybil rings are cheap to mint and therefore stay near the floor.
const ATTESTER_WEIGHT_FLOOR = 0.1;

// Composite blend. Dispute is inverted (lower is better); weights sum to 1.
const COMPOSITE_WEIGHTS = { reliability: 0.4, completion: 0.25, dispute: 0.2, sla: 0.15 };

// ─── Reputation Engine ───

export class ReputationEngine {
  private decayConfig: DecayConfig;

  constructor(decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG) {
    this.decayConfig = decayConfig;
  }

  computeVector(
    events: ReputationEvent[],
    now: Date = new Date(),
    attesterWeights?: Map<EvmAddress, number>,
  ): ReputationVector {
    const reliabilityScore = computeReliability(events, now, this.decayConfig, attesterWeights);
    const completionRate = computeCompletionRate(events, now, this.decayConfig, attesterWeights);
    const disputeRate = computeDisputeRate(events, now, this.decayConfig, attesterWeights);
    const slaAdherence = computeSlaAdherence(events, now, this.decayConfig, attesterWeights);
    const volumeWeight = computeVolumeWeight(events, now, this.decayConfig, attesterWeights);

    const lastEvent = events.length > 0
      ? events.reduce((latest, e) => e.timestamp > latest.timestamp ? e : latest, events[0]!)
      : null;

    return {
      reliabilityScore,
      completionRate,
      disputeRate,
      slaAdherence,
      volumeWeight,
      totalEvents: events.length,
      lastEventTimestamp: lastEvent?.timestamp ?? '',
      computedAt: now.toISOString(),
      compositeScore: computeComposite(
        { reliabilityScore, completionRate, disputeRate, slaAdherence },
        confidenceFrom(volumeWeight),
      ),
    };
  }

  /**
   * Weight an attester's testimony by its own standing (one level deep, no recursion).
   * A wallet with no history of its own sits at the floor.
   */
  computeAttesterWeight(attesterVector: ReputationVector): number {
    return ATTESTER_WEIGHT_FLOOR
      + (1 - ATTESTER_WEIGHT_FLOOR) * this.computeConfidence(attesterVector) * attesterVector.reliabilityScore;
  }

  computeSummary(agentId: EvmAddress, vector: ReputationVector): ReputationSummary {
    return {
      agentId,
      reliabilityScore: vector.reliabilityScore,
      completionRate: vector.completionRate,
      disputeRate: vector.disputeRate,
      slaAdherence: vector.slaAdherence,
      volumeWeight: vector.volumeWeight,
      compositeScore: vector.compositeScore,
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
    return confidenceFrom(vector.volumeWeight);
  }
}

/**
 * confidence = 1 - e^(-0.1 * volumeWeight), range [0,1)
 */
function confidenceFrom(volumeWeight: number): number {
  return 1 - Math.exp(-0.1 * volumeWeight);
}

/**
 * Composite 0-100 score. The dimension blend is pulled toward 50 by (1 - confidence),
 * so an agent nobody has vouched for reads as "unknown", not "good".
 * Derived purely from the other fields, so a cached vector can rebuild it.
 */
export function computeCompositeScore(vector: Omit<ReputationVector, 'compositeScore'>): number {
  return computeComposite(vector, confidenceFrom(vector.volumeWeight));
}

function computeComposite(
  dims: Pick<ReputationVector, 'reliabilityScore' | 'completionRate' | 'disputeRate' | 'slaAdherence'>,
  confidence: number,
): number {
  const blend =
    COMPOSITE_WEIGHTS.reliability * dims.reliabilityScore
    + COMPOSITE_WEIGHTS.completion * dims.completionRate
    + COMPOSITE_WEIGHTS.dispute * (1 - dims.disputeRate)
    + COMPOSITE_WEIGHTS.sla * dims.slaAdherence;

  return Math.round(100 * (0.5 + (blend - 0.5) * confidence));
}
