const MS_PER_DAY = 86_400_000;

export interface DecayConfig {
  halfLifeDays: number;
}

const DEFAULT_CONFIG: DecayConfig = {
  halfLifeDays: 90,
};

/**
 * Compute lambda (decay constant) from half-life.
 * lambda = ln(2) / halfLifeDays
 */
export function computeLambda(halfLifeDays: number): number {
  return Math.LN2 / halfLifeDays;
}

/**
 * Exponential time-decay weight.
 * weight(t) = e^(-lambda * deltaT)
 *
 * - At t=0 (event just happened): weight = 1.0
 * - At t=halfLife: weight = 0.5
 * - At t=2*halfLife: weight = 0.25
 * - Future events (negative deltaT): clamped to 1.0
 */
export function decayWeight(
  eventTimestamp: string,
  now: Date,
  config: DecayConfig = DEFAULT_CONFIG,
): number {
  const eventTime = new Date(eventTimestamp).getTime();
  const nowTime = now.getTime();
  const deltaDays = (nowTime - eventTime) / MS_PER_DAY;

  // Future events clamped to weight 1.0
  if (deltaDays <= 0) return 1.0;

  const lambda = computeLambda(config.halfLifeDays);
  return Math.exp(-lambda * deltaDays);
}

/**
 * Check if an event is within the "active" window (2 * halfLife).
 */
export function isWithinActiveWindow(
  lastEventTimestamp: string,
  now: Date,
  config: DecayConfig = DEFAULT_CONFIG,
): boolean {
  const eventTime = new Date(lastEventTimestamp).getTime();
  const nowTime = now.getTime();
  const deltaDays = (nowTime - eventTime) / MS_PER_DAY;
  return deltaDays <= 2 * config.halfLifeDays;
}

export { DEFAULT_CONFIG as DEFAULT_DECAY_CONFIG };
