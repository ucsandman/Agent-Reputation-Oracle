import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventLog } from '../src/storage/event-log.js';
import { erc8004OptionsFromEnv, indexErc8004, formatIndexerResult } from '../src/erc8004/indexer.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const DB_PATH = process.env['DB_PATH'] ?? './data/reputation.db';

async function main(): Promise<void> {
  const opts = erc8004OptionsFromEnv();
  if (!opts) {
    console.error(
      'Missing env: ERC8004_RPC_URL, ERC8004_CHAIN_ID, ERC8004_REPUTATION_REGISTRY, ERC8004_IDENTITY_REGISTRY are required'
    );
    process.exit(1);
  }

  const dbDir = dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const eventLog = new EventLog(DB_PATH);
  try {
    const result = await indexErc8004(eventLog, opts);
    if (result.start > result.latest) {
      console.log(`Nothing to do: cursor at ${result.start - 1n}, head at ${result.latest}`);
    } else {
      console.log(formatIndexerResult(opts.chainId, result));
    }
  } finally {
    eventLog.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
