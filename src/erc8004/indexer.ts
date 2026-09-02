import { createPublicClient, fallback, http, parseAbiItem, getAddress } from 'viem';
import { EventLog } from '../storage/event-log.js';
import { mapFeedbackToEvent, erc8004AgentId, withUriUpdate } from './map.js';
import type { EvmAddress } from '../types/index.js';

// ERC-8004 Reputation Registry feedback log (verified against Base mainnet, see docs/erc8004.md)
const NEW_FEEDBACK = parseAbiItem(
  'event NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint64 feedbackIndex, int128 value, uint8 valueDecimals, string indexed indexedTag1, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)'
);
const OWNER_OF = parseAbiItem('function ownerOf(uint256 tokenId) view returns (address)');
// Identity Registry agentURI change (verified against Base mainnet, see docs/erc8004.md)
const URI_UPDATED = parseAbiItem('event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy)');

export interface Erc8004IndexerOptions {
  /** One or more JSON-RPC URLs; more than one becomes a fallback transport. */
  rpcUrls: string[];
  chainId: number;
  reputationRegistry: string;
  identityRegistry: string;
  /** First block when no cursor exists. */
  fromBlock?: bigint;
  /** Last block to index; defaults to chain head. */
  toBlock?: bigint;
  chunk?: bigint;
  /** Called for every agent whose stored data changed, so a live server can drop its cache. */
  onAgentTouched?: (agentId: EvmAddress) => void;
  /** Called every 100 chunks with the running totals, for long backfills. */
  onProgress?: (partial: Erc8004IndexerResult) => void;
}

export interface Erc8004IndexerResult {
  start: bigint;
  latest: bigint;
  fetched: number;
  imported: number;
  skipped: number;
  uriUpdates: number;
  lastBlock: bigint;
}

/** Reads ERC8004_* env; null when the importer is not configured. Throws on a half-configured set. */
export function erc8004OptionsFromEnv(env: NodeJS.ProcessEnv = process.env): Erc8004IndexerOptions | null {
  const rpc = env['ERC8004_RPC_URL'];
  const chainId = parseInt(env['ERC8004_CHAIN_ID'] ?? '', 10);
  const reputationRegistry = env['ERC8004_REPUTATION_REGISTRY'];
  const identityRegistry = env['ERC8004_IDENTITY_REGISTRY'];
  if (!rpc && !reputationRegistry && !identityRegistry && Number.isNaN(chainId)) return null;
  if (!rpc || !reputationRegistry || !identityRegistry || Number.isNaN(chainId)) {
    throw new Error('ERC8004_RPC_URL, ERC8004_CHAIN_ID, ERC8004_REPUTATION_REGISTRY, ERC8004_IDENTITY_REGISTRY must all be set');
  }
  return {
    rpcUrls: rpc.split(',').map((u) => u.trim()).filter(Boolean),
    chainId,
    reputationRegistry,
    identityRegistry,
    ...(env['ERC8004_FROM_BLOCK'] ? { fromBlock: BigInt(env['ERC8004_FROM_BLOCK']) } : {}),
    ...(env['ERC8004_TO_BLOCK'] ? { toBlock: BigInt(env['ERC8004_TO_BLOCK']) } : {}),
  };
}

/**
 * Pulls NewFeedback and URIUpdated logs from the cursor (or fromBlock) to toBlock (or head)
 * into the event log. Resumable: the cursor lives in the same SQLite file. Safe to re-run.
 */
export async function indexErc8004(eventLog: EventLog, opts: Erc8004IndexerOptions): Promise<Erc8004IndexerResult> {
  const chunk = opts.chunk ?? 5000n;
  const db = eventLog.getDatabase();
  db.exec('CREATE TABLE IF NOT EXISTS erc8004_cursor (key TEXT PRIMARY KEY, last_block INTEGER NOT NULL)');

  const reputationRegistry = getAddress(opts.reputationRegistry);
  const identityRegistry = getAddress(opts.identityRegistry);
  const cursorKey = `${opts.chainId}:${reputationRegistry.toLowerCase()}`;
  const cursorRow = db
    .prepare('SELECT last_block FROM erc8004_cursor WHERE key = ?')
    .get(cursorKey) as { last_block: number } | undefined;

  // batch: concurrent calls within 10ms collapse into one JSON-RPC batch request.
  const transports = opts.rpcUrls.map((u) => http(u, { timeout: 30_000, retryCount: 1, batch: { batchSize: 50, wait: 10 } }));
  const client = createPublicClient({ transport: transports.length > 1 ? fallback(transports) : transports[0]! });
  const latest = opts.toBlock ?? (await client.getBlockNumber());
  const start = cursorRow ? BigInt(cursorRow.last_block) + 1n : (opts.fromBlock ?? 0n);

  const result: Erc8004IndexerResult = { start, latest, fetched: 0, imported: 0, skipped: 0, uriUpdates: 0, lastBlock: start - 1n };
  if (start > latest) return result;

  const owners = new Map<string, EvmAddress>();
  const burned = new Set<string>();
  const blockTimes = new Map<string, number>();
  const touched = (agentId: EvmAddress): void => opts.onAgentTouched?.(agentId);

  // Bounded-concurrency map; with the batched transport, 20 in flight is one or two RPC round trips.
  async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < items.length) await fn(items[next++]!);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }

  // Merge into the existing erc8004 metadata so feedback imports and URI updates never clobber each other.
  function mergeErc8004(agentId: EvmAddress, tokenId: string, patch: (erc: Record<string, unknown>) => Record<string, unknown>): void {
    const current = eventLog.getAgent(agentId)?.metadata ?? {};
    const erc = (current['erc8004'] as Record<string, unknown> | undefined) ?? { chainId: opts.chainId, identityRegistry, tokenId };
    eventLog.ensureAgent(agentId, { ...current, erc8004: patch(erc) });
  }

  // Public RPCs shed load in bursts; one refused chunk must not abort a multi-hour backfill.
  // ponytail: fixed 3-step backoff, make it configurable if a paid RPC needs different pacing.
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [2_000, 5_000, 10_000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt >= delays.length) throw err;
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  for (let from = start; from <= latest; from += chunk) {
    const to = from + chunk - 1n > latest ? latest : from + chunk - 1n;

    const [logs, uriLogs] = await Promise.all([
      withRetry(() => client.getLogs({ address: reputationRegistry, event: NEW_FEEDBACK, fromBlock: from, toBlock: to })),
      withRetry(() => client.getLogs({ address: identityRegistry, event: URI_UPDATED, fromBlock: from, toBlock: to })),
    ]);
    result.fetched += logs.length;

    // Prefetch every block timestamp and unknown token owner this chunk needs, concurrently.
    const blocksNeeded = [...new Set([...logs, ...uriLogs].map((l) => l.blockNumber!.toString()))].filter((b) => !blockTimes.has(b));
    await mapLimit(blocksNeeded, 20, async (b) => {
      blockTimes.set(b, Number((await withRetry(() => client.getBlock({ blockNumber: BigInt(b) }))).timestamp));
    });
    const tokensNeeded = [...new Set(logs.map((l) => l.args.agentId!.toString()))].filter((t) => !owners.has(t) && !burned.has(t));
    await mapLimit(tokensNeeded, 20, async (t) => {
      try {
        owners.set(t, (await withRetry(() => client.readContract({
          address: identityRegistry,
          abi: [OWNER_OF],
          functionName: 'ownerOf',
          args: [BigInt(t)],
        }))) as EvmAddress);
      } catch {
        burned.add(t); // burned or unregistered agent token
      }
    });

    for (const log of logs) {
      const agentKey = log.args.agentId!.toString();
      const owner = owners.get(agentKey);
      if (!owner) {
        result.skipped++; // burned or unregistered agent token
        continue;
      }

      const blockTimestamp = blockTimes.get(log.blockNumber!.toString())!;

      const event = mapFeedbackToEvent(opts.chainId, {
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockTimestamp,
        identityRegistry,
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
        result.skipped++; // self-feedback
        continue;
      }

      mergeErc8004(event.agentId, agentKey, (erc) => ({ ...erc, owner }));
      eventLog.ensureAgent(event.sourceAgentId);
      if (eventLog.appendEvent(event)) {
        result.imported++;
        touched(event.agentId);
      } else {
        result.skipped++; // already imported
      }
    }

    // agentURI changes: the owner swapped what the token points at. Recorded, not scored,
    // so a consumer can discount history from before the swap.
    for (const log of uriLogs) {
      const tokenId = log.args.agentId!;
      const agentId = erc8004AgentId(opts.chainId, identityRegistry, tokenId);
      const update = {
        txHash: log.transactionHash!,
        logIndex: log.logIndex!,
        blockNumber: Number(log.blockNumber!),
        timestamp: new Date(blockTimes.get(log.blockNumber!.toString())! * 1000).toISOString(),
        updatedBy: getAddress(log.args.updatedBy!) as EvmAddress,
        newURI: log.args.newURI ?? '',
      };
      mergeErc8004(agentId, tokenId.toString(), (erc) => withUriUpdate(erc, update));
      result.uriUpdates++;
      touched(agentId);
    }

    result.lastBlock = to;
    db.prepare(
      'INSERT INTO erc8004_cursor (key, last_block) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last_block = excluded.last_block'
    ).run(cursorKey, Number(to));
    if (((to - start + 1n) / chunk) % 100n === 0n) opts.onProgress?.({ ...result });
  }

  return result;
}

export function formatIndexerResult(chainId: number, r: Erc8004IndexerResult): string {
  return `erc8004 chain=${chainId} range=${r.start}-${r.latest} fetched=${r.fetched} imported=${r.imported} skipped=${r.skipped} uriUpdates=${r.uriUpdates} lastBlock=${r.lastBlock}`;
}
