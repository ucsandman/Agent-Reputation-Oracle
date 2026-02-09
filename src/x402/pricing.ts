import type { AppConfig } from '../types/index.js';

export interface PricingConfig {
  reputationQuery: string;
  reputationSummary: string;
  attestationQuery: string;
  eventSubmit: string;
}

export function createPricingConfig(config: AppConfig): PricingConfig {
  return {
    reputationQuery: `$${config.pricing.reputationQuery}`,
    reputationSummary: `$${config.pricing.reputationSummary}`,
    attestationQuery: `$${config.pricing.attestationQuery}`,
    eventSubmit: `$${config.pricing.eventSubmit}`,
  };
}
