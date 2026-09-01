import { decayWeight, type DecayConfig, DEFAULT_DECAY_CONFIG } from './decay.js';
import type { ReputationEvent, EvmAddress } from '../types/index.js';

// ─── Prior Configurations ───

interface BayesianPrior {
  weight: number;
  value: number;
}

const RELIABILITY_PRIOR: BayesianPrior = { weight: 5, value: 0.5 };
const COMPLETION_PRIOR: BayesianPrior = { weight: 3, value: 0.7 };
const DISPUTE_PRIOR: BayesianPrior = { weight: 5, value: 0.05 };
const SLA_PRIOR: BayesianPrior = { weight: 2, value: 0.8 };

// ─── Attester Diversity Caps ───

// One attester supplies at most MAX_ATTESTER_EVIDENCE events-worth of a dimension,
// scaled by its own weight, and at most MAX_ATTESTER_SHARE of that dimension's total.
// 8 and 0.5 are chosen so a ring of three fresh wallets (weight 0.1) contributes at
// most 3 * 0.8 = 2.4 against a prior of 5 — not enough to move a score or clear the
// confidence gate — while one well-established attester (weight ~0.9) still supplies
// 7.2, which carries a real score. High scores therefore need several credible
// attesters, not one loud voice.
const MAX_ATTESTER_EVIDENCE = 8;
const MAX_ATTESTER_SHARE = 0.5;

interface WeightedValue {
  source: EvmAddress;
  weight: number;
  value: number;
}

/**
 * Decay weight for an event, scaled by its attester's weight (default 1).
 */
function eventWeight(
  event: ReputationEvent,
  now: Date,
  decayConfig: DecayConfig,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  return decayWeight(event.timestamp, now, decayConfig) * (attesterWeights?.get(event.sourceAgentId) ?? 1);
}

/**
 * Scale down any attester whose total contribution exceeds its cap.
 */
function capByAttester(
  weightedValues: WeightedValue[],
  attesterWeights?: Map<EvmAddress, number>,
): WeightedValue[] {
  const bySource = new Map<EvmAddress, number>();
  let total = 0;

  for (const wv of weightedValues) {
    total += wv.weight;
    bySource.set(wv.source, (bySource.get(wv.source) ?? 0) + wv.weight);
  }

  return weightedValues.map((wv) => {
    const sourceTotal = bySource.get(wv.source) ?? 0;
    const cap = Math.min(
      MAX_ATTESTER_EVIDENCE * (attesterWeights?.get(wv.source) ?? 1),
      MAX_ATTESTER_SHARE * total,
    );
    return sourceTotal > cap ? { ...wv, weight: (wv.weight * cap) / sourceTotal } : wv;
  });
}

// ─── Scoring Functions ───

/**
 * Weighted Bayesian average, after per-attester capping.
 * result = (prior_w * prior_v + sum(w_i * x_i)) / (prior_w + sum(w_i))
 */
function bayesianAverage(
  prior: BayesianPrior,
  weightedValues: WeightedValue[],
  attesterWeights?: Map<EvmAddress, number>,
): number {
  let weightSum = 0;
  let valueSum = 0;

  for (const wv of capByAttester(weightedValues, attesterWeights)) {
    weightSum += wv.weight;
    valueSum += wv.weight * wv.value;
  }

  return (prior.weight * prior.value + valueSum) / (prior.weight + weightSum);
}

/**
 * Compute reliability score from relevant events.
 * Events: transaction_completed, arbitration_result, slash, attestation[reliability]
 */
export function computeReliability(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  const weightedValues: WeightedValue[] = [];

  for (const event of events) {
    const w = eventWeight(event, now, decayConfig, attesterWeights);
    const source = event.sourceAgentId;

    switch (event.data.type) {
      case 'transaction_completed':
        weightedValues.push({ source, weight: w, value: event.data.completedSuccessfully ? 1.0 : 0.0 });
        break;
      case 'arbitration_result':
        {
          const outcomeValue =
            event.data.outcome === 'agent_favored' ? 1.0
            : event.data.outcome === 'split' ? 0.5
            : 0.0;
          weightedValues.push({ source, weight: w, value: outcomeValue });
        }
        break;
      case 'slash':
        {
          const slashValue = event.data.severity === 'minor' ? 0.2 : 0.0;
          weightedValues.push({ source, weight: w, value: slashValue });
        }
        break;
      case 'attestation':
        if (event.data.category === 'reliability') {
          weightedValues.push({ source, weight: w, value: event.data.confidence });
        }
        break;
    }
  }

  return bayesianAverage(RELIABILITY_PRIOR, weightedValues, attesterWeights);
}

/**
 * Compute completion rate from transaction_completed events.
 */
export function computeCompletionRate(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  const weightedValues: WeightedValue[] = [];

  for (const event of events) {
    if (event.data.type === 'transaction_completed') {
      const w = eventWeight(event, now, decayConfig, attesterWeights);
      weightedValues.push({
        source: event.sourceAgentId,
        weight: w,
        value: event.data.completedSuccessfully ? 1.0 : 0.0,
      });
    }
  }

  return bayesianAverage(COMPLETION_PRIOR, weightedValues, attesterWeights);
}

/**
 * Compute dispute rate from transaction_completed + arbitration_result events.
 * is_dispute = 1.0 for arbitration events, 0.0 for completed transactions.
 */
export function computeDisputeRate(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  const weightedValues: WeightedValue[] = [];

  for (const event of events) {
    const w = eventWeight(event, now, decayConfig, attesterWeights);
    const source = event.sourceAgentId;

    if (event.data.type === 'arbitration_result') {
      weightedValues.push({ source, weight: w, value: 1.0 });
    } else if (event.data.type === 'transaction_completed') {
      weightedValues.push({ source, weight: w, value: 0.0 });
    }
  }

  return bayesianAverage(DISPUTE_PRIOR, weightedValues, attesterWeights);
}

/**
 * Compute SLA adherence from sla_verified events.
 */
export function computeSlaAdherence(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  const weightedValues: WeightedValue[] = [];

  for (const event of events) {
    if (event.data.type === 'sla_verified') {
      const w = eventWeight(event, now, decayConfig, attesterWeights);
      weightedValues.push({ source: event.sourceAgentId, weight: w, value: event.data.metSla ? 1.0 : 0.0 });
    }
  }

  return bayesianAverage(SLA_PRIOR, weightedValues, attesterWeights);
}

/**
 * Compute volume weight (sublinear growth to prevent gaming).
 * volumeWeight = ln(1 + sum(w_i))
 */
export function computeVolumeWeight(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
  attesterWeights?: Map<EvmAddress, number>,
): number {
  const weightedValues: WeightedValue[] = events.map((event) => ({
    source: event.sourceAgentId,
    weight: eventWeight(event, now, decayConfig, attesterWeights),
    value: 0,
  }));

  let weightSum = 0;
  for (const wv of capByAttester(weightedValues, attesterWeights)) {
    weightSum += wv.weight;
  }

  return Math.log(1 + weightSum);
}
