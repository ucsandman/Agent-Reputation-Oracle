import { loadConfig } from './config.js';
import { createOracleApp } from './app.js';

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

function shutdown() {
  server.close(() => {
    oracle.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export const app = oracle.app;
