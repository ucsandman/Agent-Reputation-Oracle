import request from 'supertest';
import { keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { v4 as uuidv4 } from 'uuid';
import { createOracleApp } from '../src/app.js';
import {
  getReputationOracleDomain,
  REPUTATION_EVENT_TYPES,
} from '../src/crypto/signing.js';
import type {
  AppConfig,
  EvmAddress,
  ReputationEventData,
} from '../src/types/index.js';

const ORACLE_PRIVATE_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ATTESTER_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const SUBJECT_AGENT_ID =
  '0x1111111111111111111111111111111111111111' as EvmAddress;

const attester = privateKeyToAccount(ATTESTER_PRIVATE_KEY);

const config: AppConfig = {
  port: 3402,
  nodeEnv: 'test',
  x402: {
    network: 'eip155:84532',
    payTo: '0x0000000000000000000000000000000000000000',
    facilitatorUrl: 'http://localhost:4021',
    scheme: 'exact',
    syncOnStart: false,
  },
  pricing: {
    reputationQuery: '0',
    reputationSummary: '0',
    attestationQuery: '0',
    eventSubmit: '0',
  },
  db: {
    path: ':memory:',
  },
  server: {
    privateKey: ORACLE_PRIVATE_KEY,
  },
  security: {
    maxEventsPerAgentPerHour: 100,
  },
};

async function signedEvent(data: ReputationEventData) {
  const id = uuidv4();
  const timestamp = new Date().toISOString();
  const dataHash = keccak256(toHex(JSON.stringify(data)));

  const signature = await attester.signTypedData({
    domain: getReputationOracleDomain(),
    types: REPUTATION_EVENT_TYPES,
    primaryType: 'ReputationEvent',
    message: {
      id,
      agentId: SUBJECT_AGENT_ID,
      eventType: data.type,
      timestamp,
      dataHash,
    },
  });

  return {
    id,
    agentId: SUBJECT_AGENT_ID,
    eventType: data.type,
    timestamp,
    data,
    proof: {
      signature,
      signer: attester.address,
      domain: 'AgentReputationOracle',
      typedDataHash: dataHash,
    },
    sourceAgentId: attester.address,
  };
}

async function main() {
  const oracle = createOracleApp(config);

  try {
    const events = [
      await signedEvent({
        type: 'transaction_completed',
        completedSuccessfully: true,
        valueUsd: 125,
        durationMs: 4200,
      }),
      await signedEvent({
        type: 'sla_verified',
        metSla: true,
        slaType: 'response_time',
        measuredValue: 180,
        threshold: 250,
      }),
      await signedEvent({
        type: 'attestation',
        category: 'quality',
        confidence: 0.92,
        comment: 'Delivered a correct result with clear handoff metadata.',
      }),
    ];

    console.log('Agent Reputation Oracle demo');
    console.log(`Subject agent:  ${SUBJECT_AGENT_ID}`);
    console.log(`Attester agent: ${attester.address}`);
    console.log(`Oracle signer:  ${oracle.attestationService.oracleAddress}`);

    for (const event of events) {
      const response = await request(oracle.app)
        .post('/v1/reputation/event')
        .send(event)
        .expect(201);
      console.log(`Accepted ${event.eventType}: ${response.body.eventId}`);
    }

    const reputation = await request(oracle.app)
      .get(`/v1/reputation/${SUBJECT_AGENT_ID}`)
      .expect(200);

    const receiptValid = await oracle.receiptService.verifyReceipt(reputation.body.receipt);

    console.log('\nComputed reputation vector');
    console.log(JSON.stringify(reputation.body.vector, null, 2));
    console.log(`\nReceipt signature valid: ${receiptValid}`);
    console.log(`Vector hash: ${reputation.body.receipt.vectorHash}`);
  } finally {
    oracle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
