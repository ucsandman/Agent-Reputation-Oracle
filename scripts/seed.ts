import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { privateKeyToAccount } from 'viem/accounts';
import { EventLog } from '../src/storage/event-log.js';
import { REPUTATION_ORACLE_DOMAIN, REPUTATION_EVENT_TYPES, hashEvent } from '../src/crypto/signing.js';
import type { ReputationEvent, EvmAddress, ReputationEventData } from '../src/types/index.js';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const DB_PATH = process.env['DB_PATH'] ?? './data/reputation.db';

// Test accounts (Hardhat default accounts - never use in production)
const AGENT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const SOURCE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const SOURCE2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as const;

const agentAccount = privateKeyToAccount(AGENT_KEY);
const sourceAccount = privateKeyToAccount(SOURCE_KEY);
const source2Account = privateKeyToAccount(SOURCE2_KEY);

const agentId = agentAccount.address as EvmAddress;
const sourceAgentId = sourceAccount.address as EvmAddress;
const source2AgentId = source2Account.address as EvmAddress;

async function createSignedEvent(
  targetAgentId: EvmAddress,
  signerAccount: ReturnType<typeof privateKeyToAccount>,
  data: ReputationEventData,
  timestamp: string,
): Promise<ReputationEvent> {
  const event: ReputationEvent = {
    id: uuidv4(),
    agentId: targetAgentId,
    eventType: data.type,
    timestamp,
    data,
    proof: {
      signature: '0x' as `0x${string}`,
      signer: signerAccount.address as EvmAddress,
      domain: 'AgentReputationOracle',
      typedDataHash: '0x' as `0x${string}`,
    },
    sourceAgentId: signerAccount.address as EvmAddress,
  };

  const dataHash = hashEvent(event);

  const signature = await signerAccount.signTypedData({
    domain: REPUTATION_ORACLE_DOMAIN,
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message: {
      id: event.id,
      agentId: event.agentId,
      eventType: event.eventType,
      timestamp: event.timestamp,
      dataHash,
    },
  });

  event.proof.signature = signature;
  event.proof.typedDataHash = dataHash;

  return event;
}

async function seed(): Promise<void> {
  const dbDir = dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const eventLog = new EventLog(DB_PATH);

  // Ensure agents
  eventLog.ensureAgent(agentId);
  eventLog.ensureAgent(sourceAgentId);
  eventLog.ensureAgent(source2AgentId);

  const now = Date.now();
  const day = 86_400_000;

  const events: ReputationEvent[] = [];

  // Successful transactions (from source agent about target agent)
  for (let i = 0; i < 10; i++) {
    events.push(await createSignedEvent(agentId, sourceAccount, {
      type: 'transaction_completed',
      completedSuccessfully: true,
      valueUsd: 50 + Math.random() * 100,
      durationMs: 1000 + Math.floor(Math.random() * 5000),
    }, new Date(now - (i * 7 * day)).toISOString()));
  }

  // A failed transaction
  events.push(await createSignedEvent(agentId, sourceAccount, {
    type: 'transaction_completed',
    completedSuccessfully: false,
    valueUsd: 25,
    durationMs: 30000,
  }, new Date(now - 30 * day).toISOString()));

  // SLA verifications
  for (let i = 0; i < 5; i++) {
    events.push(await createSignedEvent(agentId, source2Account, {
      type: 'sla_verified',
      metSla: i < 4, // 4 out of 5 met SLA
      slaType: 'response_time',
      measuredValue: 100 + Math.random() * 200,
      threshold: 300,
    }, new Date(now - (i * 14 * day)).toISOString()));
  }

  // Attestation from second source
  events.push(await createSignedEvent(agentId, source2Account, {
    type: 'attestation',
    category: 'reliability',
    confidence: 0.85,
    comment: 'Consistently reliable agent',
  }, new Date(now - 5 * day).toISOString()));

  // Append all events
  let inserted = 0;
  for (const event of events) {
    if (eventLog.appendEvent(event)) {
      inserted++;
    }
  }

  console.log(`Seeded ${inserted} events for agent ${agentId}`);
  console.log(`Source agents: ${sourceAgentId}, ${source2AgentId}`);

  eventLog.close();
}

seed().catch(console.error);
