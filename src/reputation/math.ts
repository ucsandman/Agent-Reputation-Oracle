import { decayWeight, type DecayConfig, DEFAULT_DECAY_CONFIG } from './decay.js';
import type { ReputationEvent } from '../types/index.js';

// ─── Prior Configurations ───

interface BayesianPrior {
  weight: number;
  value: number;
}

const RELIABILITY_PRIOR: BayesianPrior = { weight: 5, value: 0.5 };
const COMPLETION_PRIOR: BayesianPrior = { weight: 3, value: 0.7 };
const DISPUTE_PRIOR: BayesianPrior = { weight: 5, value: 0.05 };
const SLA_PRIOR: BayesianPrior = { weight: 2, value: 0.8 };

// ─── Scoring Functions ───

/**
 * Weighted Bayesian average.
 * result = (prior_w * prior_v + sum(w_i * x_i)) / (prior_w + sum(w_i))
 */
function bayesianAverage(
  prior: BayesianPrior,
  weightedValues: Array<{ weight: number; value: number }>,
): number {
  let weightSum = 0;
  let valueSum = 0;

  for (const wv of weightedValues) {
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
): number {
  const weightedValues: Array<{ weight: number; value: number }> = [];

  for (const event of events) {
    const w = decayWeight(event.timestamp, now, decayConfig);

    switch (event.data.type) {
      case 'transaction_completed':
        weightedValues.push({ weight: w, value: event.data.completedSuccessfully ? 1.0 : 0.0 });
        break;
      case 'arbitration_result':
        {
          const outcomeValue =
            event.data.outcome === 'agent_favored' ? 1.0
            : event.data.outcome === 'split' ? 0.5
            : 0.0;
          weightedValues.push({ weight: w, value: outcomeValue });
        }
        break;
      case 'slash':
        {
          const slashValue = event.data.severity === 'minor' ? 0.2 : 0.0;
          weightedValues.push({ weight: w, value: slashValue });
        }
        break;
      case 'attestation':
        if (event.data.category === 'reliability') {
          weightedValues.push({ weight: w, value: event.data.confidence });
        }
        break;
    }
  }

  return bayesianAverage(RELIABILITY_PRIOR, weightedValues);
}

/**
 * Compute completion rate from transaction_completed events.
 */
export function computeCompletionRate(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  const weightedValues: Array<{ weight: number; value: number }> = [];

  for (const event of events) {
    if (event.data.type === 'transaction_completed') {
      const w = decayWeight(event.timestamp, now, decayConfig);
      weightedValues.push({ weight: w, value: event.data.completedSuccessfully ? 1.0 : 0.0 });
    }
  }

  return bayesianAverage(COMPLETION_PRIOR, weightedValues);
}

/**
 * Compute dispute rate from transaction_completed + arbitration_result events.
 * is_dispute = 1.0 for arbitration events, 0.0 for completed transactions.
 */
export function computeDisputeRate(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  const weightedValues: Array<{ weight: number; value: number }> = [];

  for (const event of events) {
    const w = decayWeight(event.timestamp, now, decayConfig);

    if (event.data.type === 'arbitration_result') {
      weightedValues.push({ weight: w, value: 1.0 });
    } else if (event.data.type === 'transaction_completed') {
      weightedValues.push({ weight: w, value: 0.0 });
    }
  }

  return bayesianAverage(DISPUTE_PRIOR, weightedValues);
}

/**
 * Compute SLA adherence from sla_verified events.
 */
export function computeSlaAdherence(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  const weightedValues: Array<{ weight: number; value: number }> = [];

  for (const event of events) {
    if (event.data.type === 'sla_verified') {
      const w = decayWeight(event.timestamp, now, decayConfig);
      weightedValues.push({ weight: w, value: event.data.metSla ? 1.0 : 0.0 });
    }
  }

  return bayesianAverage(SLA_PRIOR, weightedValues);
}

/**
 * Compute volume weight (sublinear growth to prevent gaming).
 * volumeWeight = ln(1 + sum(w_i))
 */
export function computeVolumeWeight(
  events: ReputationEvent[],
  now: Date,
  decayConfig: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  let weightSum = 0;

  for (const event of events) {
    weightSum += decayWeight(event.timestamp, now, decayConfig);
  }

  return Math.log(1 + weightSum);
}
