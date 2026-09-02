import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createPublicClient, http, parseAbiItem, getAddress } from 'viem';
import { EventLog } from '../src/storage/event-log.js';
import { mapFeedbackToEvent } from '../src/erc8004/map.js';
import type { EvmAddress } from '../src/types/index.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const DB_PATH = process.env['DB_PATH'] ?? './data/reputation.db';
const RPC_URL = process.env['ERC8004_RPC_URL'];
const CHAIN_ID = parseInt(process.env['ERC8004_CHAIN_ID'] ?? '', 10);
const REPUTATION_REGISTRY = process.env['ERC8004_REPUTATION_REGISTRY'];
const IDENTITY_REGISTRY = process.env['ERC8004_IDENTITY_REGISTRY'];
const FROM_BLOCK = process.env['ERC8004_FROM_BLOCK'];
const TO_BLOCK = process.env['ERC8004_TO_BLOCK'];
const CHUNK = 5000n;

if (!RPC_URL || !REPUTATION_REGISTRY || !IDENTITY_REGISTRY || Number.isNaN(CHAIN_ID)) {
  console.error(
    'Missing env: ERC8004_RPC_URL, ERC8004_CHAIN_ID, ERC8004_REPUTATION_REGISTRY, ERC8004_IDENTITY_REGISTRY are required'
  );
  process.exit(1);
}

// ERC-8004 Reputation Registry feedback log (verified against Base mainnet, see docs/erc8004.md)
const NEW_FEEDBACK = parseAbiItem(
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)'
);
const OWNER_OF = parseAbiItem('function ownerOf(uint256 tokenId) view returns (address)');

async function index(): Promise<void> {
  const dbDir = dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const eventLog = new EventLog(DB_PATH);
  const db = eventLog.getDatabase();
  db.exec('CREATE TABLE IF NOT EXISTS erc8004_cursor (key TEXT PRIMARY KEY, last_block INTEGER NOT NULL)');

  const cursorKey = `${CHAIN_ID}:${REPUTATION_REGISTRY!.toLowerCase()}`;
  const cursorRow = db
    .prepare('SELECT last_block FROM erc8004_cursor WHERE key = ?')
    .get(cursorKey) as { last_block: number } | undefined;

  const client = createPublicClient({ transport: http(RPC_URL, { timeout: 30_000 }) });
  const latest = TO_BLOCK ? BigInt(TO_BLOCK) : await client.getBlockNumber();
  const start = cursorRow ? BigInt(cursorRow.last_block) + 1n : BigInt(FROM_BLOCK ?? '0');

  if (start > latest) {
    console.log(`Nothing to do: cursor at ${start - 1n}, head at ${latest}`);
    eventLog.close();
    return;
  }

  const owners = new Map<string, EvmAddress>();
  const blockTimes = new Map<string, number>();
  let fetched = 0;
  let imported = 0;
  let skipped = 0;
  let lastBlock = start - 1n;

  for (let from = start; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;

    const logs = await client.getLogs({
      address: getAddress(REPUTATION_REGISTRY!),
      event: NEW_FEEDBACK,
      fromBlock: from,
      toBlock: to,
    });
    fetched += logs.length;

    for (const log of logs) {
      const agentKey = log.args.agentId!.toString();
      let owner = owners.get(agentKey);
      if (!owner) {
        try {
          owner = (await client.readContract({
            address: getAddress(IDENTITY_REGISTRY!),
            abi: [OWNER_OF],
            functionName: 'ownerOf',
            args: [log.args.agentId!],
          })) as EvmAddress;
        } catch {
          skipped++; // burned or unregistered agent token
          continue;
        }
        owners.set(agentKey, owner);
      }

      const blockKey = log.blockNumber!.toString();
      let blockTimestamp = blockTimes.get(blockKey);
      if (blockTimestamp === undefined) {
        blockTimestamp = Number((await client.getBlock({ blockNumber: log.blockNumber! })).timestamp);
        blockTimes.set(blockKey, blockTimestamp);
      }

      const event = mapFeedbackToEvent(CHAIN_ID, {
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockTimestamp,
        identityRegistry: IDENTITY_REGISTRY!,
        agentTokenId: log.args.agentId!,
        ownerAddress: owner,
        clientAddress: log.args.clientAddress!,
        value: log.args.value!,
        valueDecimals: log.args.valueDecimals!,
        ...(log.args.tag1 ? { tag1: log.args.tag1 } : {}),
        ...(log.args.tag2 ? { tag2: log.args.tag2 } : {}),
        ...(log.args.feedbackURI ? { feedbackURI: log.args.feedbackURI } : {}),
      });

      if (!event) {
        skipped++; // self-feedback
        continue;
      }

      eventLog.ensureAgent(event.agentId, {
        erc8004: { chainId: CHAIN_ID, identityRegistry: getAddress(IDENTITY_REGISTRY!), tokenId: agentKey, owner },
      });
      eventLog.ensureAgent(event.sourceAgentId);
      if (eventLog.appendEvent(event)) {
        imported++;
      } else {
        skipped++; // already imported
      }
    }

    lastBlock = to;
    db.prepare(
      'INSERT INTO erc8004_cursor (key, last_block) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last_block = excluded.last_block'
    ).run(cursorKey, Number(lastBlock));
  }

  console.log(`chain=${CHAIN_ID} range=${start}-${latest}`);
  console.log(`fetched=${fetched} imported=${imported} skipped=${skipped} lastBlock=${lastBlock}`);

  eventLog.close();
}

index().catch((error) => {
  console.error(error);
  process.exit(1);
});
