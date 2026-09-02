import { loadConfig } from './config.js';
import { createOracleApp } from './app.js';
import { erc8004OptionsFromEnv, indexErc8004, formatIndexerResult } from './erc8004/indexer.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const config = loadConfig();
const oracle = createOracleApp(config);

const server = oracle.app.listen(config.port, () => {
  console.log(`Agent Reputation Oracle running on port ${config.port}`);
  console.log(`Oracle address: ${oracle.attestationService.oracleAddress}`);
  console.log(`Network: ${config.x402.network}`);
  console.log(`Facilitator: ${config.x402.facilitatorUrl}`);
});

// Keep the oracle current with ERC-8004 without a separate job: backfill on boot, then poll.
const erc8004 = erc8004OptionsFromEnv();
let syncTimer: NodeJS.Timeout | undefined;
if (erc8004) {
  const intervalMs = 1000 * Math.max(30, parseInt(process.env['ERC8004_SYNC_INTERVAL_SECONDS'] ?? '300', 10) || 300);
  let running = false;
  const sync = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await indexErc8004(oracle.eventLog, {
        ...erc8004,
        onAgentTouched: (agentId) => oracle.cache.invalidate(agentId),
        onProgress: (partial) => console.log(formatIndexerResult(erc8004.chainId, partial) + ' (in progress)'),
      });
      if (result.start <= result.latest) console.log(formatIndexerResult(erc8004.chainId, result));
    } catch (err) {
      console.error('erc8004 sync failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };
  console.log(`ERC-8004 sync: chain ${erc8004.chainId}, every ${intervalMs / 1000}s`);
  void sync();
  syncTimer = setInterval(() => void sync(), intervalMs);
}

function shutdown() {
  if (syncTimer) clearInterval(syncTimer);
  server.close(() => {
    oracle.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export const app = oracle.app;
