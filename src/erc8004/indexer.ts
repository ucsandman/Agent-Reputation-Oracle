import { createPublicClient, fallback, http, parseAbiItem, getAddress, BaseError, ContractFunctionRevertedError } from 'viem';
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

/**
 * OP-stack chains produce a block every fixed interval, so timestamp = genesis + seconds * block exactly.
 * Verified on Base mainnet at blocks 0, 41663783, 50690598, 50747928 and head (2026-09-02).
 * The indexer re-checks the head block at start and falls back to eth_getBlockByNumber on a mismatch.
 */
const FIXED_BLOCK_TIME: Record<number, { genesis: number; seconds: number }> = {
  8453: { genesis: 1686789347, seconds: 2 },
};

/** Multicall3 lives at the same address on every major EVM chain. */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

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
  /** Called every 20 chunks with the running totals, for long backfills. */
  onProgress?: (partial: Erc8004IndexerResult) => void;
}

export interface Erc8004IndexerResult {
  start: bigint;
  latest: bigint;
  fetched: number;
  imported: number;
  skipped: number;
  uriUpdates: number;
  /** Tokens confirmed burned/unregistered by a direct revert; their feedback is skipped. */
  burned: number;
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

  // No JSON-RPC batching: mainnet.base.org rejects batch requests, and the fallback must work on every listed URL.
  const transports = opts.rpcUrls.map((u) => http(u, { timeout: 30_000, retryCount: 1 }));
  const client = createPublicClient({ transport: transports.length > 1 ? fallback(transports) : transports[0]! });
  const latest = opts.toBlock ?? (await client.getBlockNumber());
  const start = cursorRow ? BigInt(cursorRow.last_block) + 1n : (opts.fromBlock ?? 0n);

  const result: Erc8004IndexerResult = { start, latest, fetched: 0, imported: 0, skipped: 0, uriUpdates: 0, burned: 0, lastBlock: start - 1n };
  if (start > latest) return result;

  let fixed = FIXED_BLOCK_TIME[opts.chainId];
  if (fixed) {
    const headTs = Number((await client.getBlock({ blockNumber: latest })).timestamp);
    if (headTs !== fixed.genesis + fixed.seconds * Number(latest)) {
      console.error(`erc8004: fixed block time formula disagrees with chain ${opts.chainId} at block ${latest}, falling back to RPC lookups`);
      fixed = undefined;
    }
  }
  const blockTime = (b: bigint): number => (fixed ? fixed.genesis + fixed.seconds * Number(b) : blockTimes.get(b.toString())!);

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

  // Fetch PARALLEL_CHUNKS chunks of logs at once, then process them in block order so the cursor stays monotonic.
  const PARALLEL_CHUNKS = 4n;
  const fetchChunk = (from: bigint, to: bigint) => Promise.all([
    withRetry(() => client.getLogs({ address: reputationRegistry, event: NEW_FEEDBACK, fromBlock: from, toBlock: to })),
    withRetry(() => client.getLogs({ address: identityRegistry, event: URI_UPDATED, fromBlock: from, toBlock: to })),
  ]);

  for (let groupStart = start; groupStart <= latest; groupStart += chunk * PARALLEL_CHUNKS) {
    const ranges: Array<[bigint, bigint]> = [];
    for (let from = groupStart; from <= latest && from < groupStart + chunk * PARALLEL_CHUNKS; from += chunk) {
      ranges.push([from, from + chunk - 1n > latest ? latest : from + chunk - 1n]);
    }
    const fetched = await Promise.all(ranges.map(([from, to]) => fetchChunk(from, to)));

  for (const [i, [, to]] of ranges.entries()) {
    const [logs, uriLogs] = fetched[i]!;
    result.fetched += logs.length;

    // Prefetch every block timestamp and unknown token owner this chunk needs, concurrently.
    const blocksNeeded = fixed ? [] : [...new Set([...logs, ...uriLogs].map((l) => l.blockNumber!.toString()))].filter((b) => !blockTimes.has(b));
    await mapLimit(blocksNeeded, 20, async (b) => {
      blockTimes.set(b, Number((await withRetry(() => client.getBlock({ blockNumber: BigInt(b) }))).timestamp));
    });
    // One eth_call per chunk via Multicall3. A per-item revert means burned/unregistered; a transport
    // error throws and the chunk is retried, so an RPC outage can never masquerade as a burned token.
    const tokensNeeded = [...new Set(logs.map((l) => l.args.agentId!.toString()))].filter((t) => !owners.has(t) && !burned.has(t));
    if (tokensNeeded.length > 0) {
      const results = await withRetry(() => client.multicall({
        multicallAddress: MULTICALL3,
        allowFailure: true,
        batchSize: 16_384,
        contracts: tokensNeeded.map((t) => ({ address: identityRegistry, abi: [OWNER_OF], functionName: 'ownerOf' as const, args: [BigInt(t)] as const })),
      }));
      const unresolved: string[] = [];
      results.forEach((r, i) => {
        if (r.status === 'success') owners.set(tokensNeeded[i]!, getAddress(r.result as string) as EvmAddress);
        else unresolved.push(tokensNeeded[i]!);
      });
      // Public RPCs have returned per-item failures for live tokens. Confirm each one directly: only a
      // contract revert means burned; anything else throws so the chunk is retried instead of skipped.
      for (const t of unresolved) {
        try {
          owners.set(t, getAddress(await withRetry(() => client.readContract({
            address: identityRegistry,
            abi: [OWNER_OF],
            functionName: 'ownerOf',
            args: [BigInt(t)],
          })) as string) as EvmAddress);
        } catch (err) {
          const reverted = err instanceof BaseError && err.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
          if (!reverted) throw err;
          burned.add(t);
          result.burned++;
        }
      }
    }

    for (const log of logs) {
      const agentKey = log.args.agentId!.toString();
      const owner = owners.get(agentKey);
      if (!owner) {
        result.skipped++; // burned or unregistered agent token
        continue;
      }

      const blockTimestamp = blockTime(log.blockNumber!);

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
        timestamp: new Date(blockTime(log.blockNumber!) * 1000).toISOString(),
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
    if (((to - start + 1n) / chunk) % 20n === 0n) opts.onProgress?.({ ...result });
  }
  }

  return result;
}

export function formatIndexerResult(chainId: number, r: Erc8004IndexerResult): string {
  return `erc8004 chain=${chainId} range=${r.start}-${r.latest} fetched=${r.fetched} imported=${r.imported} skipped=${r.skipped} burned=${r.burned} uriUpdates=${r.uriUpdates} lastBlock=${r.lastBlock}`;
}
