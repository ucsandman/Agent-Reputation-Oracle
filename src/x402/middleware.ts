import { paymentMiddleware } from '@x402/express';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { registerExactEvmScheme } from '@x402/evm/exact/server';
import type { AppConfig } from '../types/index.js';
import { createPricingConfig } from './pricing.js';
import type { Network } from '@x402/core/types';

export function createPaymentMiddleware(config: AppConfig) {
  const pricing = createPricingConfig(config);
  const network = config.x402.network as Network;

  const facilitatorClient = new HTTPFacilitatorClient({
    url: config.x402.facilitatorUrl,
  });

  const server = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(server);

  // Route config: more specific routes FIRST (x402 matches in order).
  // Keep legacy unversioned routes during the /v1 transition.
  const routes = {
    'GET /v1/reputation/*/summary': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.reputationSummary,
        maxTimeoutSeconds: 60,
      },
      description: 'Lightweight reputation summary',
      mimeType: 'application/json',
    },
    'GET /v1/reputation/*/attestations': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.attestationQuery,
        maxTimeoutSeconds: 60,
      },
      description: 'Paginated event history',
      mimeType: 'application/json',
    },
    'GET /v1/reputation/*': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.reputationQuery,
        maxTimeoutSeconds: 60,
      },
      description: 'Full reputation vector with signed receipt',
      mimeType: 'application/json',
    },
    'POST /v1/reputation/event': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.eventSubmit,
        maxTimeoutSeconds: 60,
      },
      description: 'Submit signed reputation event',
      mimeType: 'application/json',
    },
    'GET /reputation/*/summary': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.reputationSummary,
        maxTimeoutSeconds: 60,
      },
      description: 'Lightweight reputation summary',
      mimeType: 'application/json',
    },
    'GET /reputation/*/attestations': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.attestationQuery,
        maxTimeoutSeconds: 60,
      },
      description: 'Paginated event history',
      mimeType: 'application/json',
    },
    'GET /reputation/*': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.reputationQuery,
        maxTimeoutSeconds: 60,
      },
      description: 'Full reputation vector with signed receipt',
      mimeType: 'application/json',
    },
    'POST /reputation/event': {
      accepts: {
        scheme: config.x402.scheme,
        network,
        payTo: config.x402.payTo,
        price: pricing.eventSubmit,
        maxTimeoutSeconds: 60,
      },
      description: 'Submit signed reputation event',
      mimeType: 'application/json',
    },
  };

  // Free writes (price 0) bootstrap the data flywheel: drop the submit routes so x402 never gates them.
  if (Number(config.pricing.eventSubmit) === 0) {
    delete (routes as Record<string, unknown>)['POST /v1/reputation/event'];
    delete (routes as Record<string, unknown>)['POST /reputation/event'];
  }

  return paymentMiddleware(routes, server, undefined, undefined, config.x402.syncOnStart);
}
