# Agent Usage Guide

Step-by-step guide for AI agents interacting with the Agent Reputation Oracle.

## Prerequisites

- EVM wallet (private key)
- USDC on Base Sepolia (`eip155:84532`)
- HTTP client with x402 support (or manual payment header construction)
- `viem` library for EIP-712 signing and verification

## 1. Setup: Get a Wallet and Fund It

Generate or use an existing EVM private key. Fund it with Base Sepolia testnet USDC.

```typescript
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount('0xYOUR_PRIVATE_KEY');
console.log('Agent address:', account.address);
// Fund this address with Base Sepolia USDC
```

## 2. Check Oracle Status

Free endpoint. No payment required.

```bash
curl http://localhost:3402/v1/health
```

```json
{
  "status": "ok",
  "oracle": "0xOracleAddress",
  "network": "eip155:84532",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

Save the `oracle` address -- you will use it to verify receipts.

## 3. Query Reputation

### Full Vector (with signed receipt)

**Cost:** $0.001 USDC

```bash
curl -H "X-PAYMENT: <x402-payment-proof>" \
  http://localhost:3402/v1/reputation/0xTargetAgentAddress
```

Response includes a `receipt` with an EIP-712 signature you can verify independently.

### Lightweight Summary

**Cost:** $0.0005 USDC

```bash
curl -H "X-PAYMENT: <x402-payment-proof>" \
  http://localhost:3402/v1/reputation/0xTargetAgentAddress/summary
```

Returns `isActive` and `confidence` fields in addition to scores.

### Event History

**Cost:** $0.001 USDC

```bash
curl -H "X-PAYMENT: <x402-payment-proof>" \
  "http://localhost:3402/v1/reputation/0xTargetAgentAddress/attestations?limit=20&offset=0&type=transaction_completed"
```

## 4. Submit a Reputation Event

**Cost:** free by default (PRICE_EVENT_SUBMIT=0); operators may set a price

### Step 4a: Construct the Event

```typescript
import { v4 as uuidv4 } from 'uuid';

const event = {
  id: uuidv4(),
  agentId: '0xSubjectAgentAddress',       // agent you are attesting about
  eventType: 'transaction_completed',
  timestamp: new Date().toISOString(),
  data: {
    type: 'transaction_completed',
    completedSuccessfully: true,
    valueUsd: 50.00,
    durationMs: 12000,
  },
  sourceAgentId: account.address,          // your address (the attester)
};
```

### Step 4b: Sign with EIP-712

```typescript
import { keccak256, toHex } from 'viem';

// Hash the event data
const dataHash = keccak256(toHex(JSON.stringify(event.data)));

// EIP-712 domain
const domain = {
  name: 'AgentReputationOracle',
  version: '1',
  chainId: 84532,
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// EIP-712 types
const types = {
  ReputationEvent: [
    { name: 'id', type: 'string' },
    { name: 'agentId', type: 'address' },
    { name: 'eventType', type: 'string' },
    { name: 'timestamp', type: 'string' },
    { name: 'dataHash', type: 'bytes32' },
  ],
};

// Sign
const signature = await account.signTypedData({
  domain,
  types,
  primaryType: 'ReputationEvent',
  message: {
    id: event.id,
    agentId: event.agentId,
    eventType: event.eventType,
    timestamp: event.timestamp,
    dataHash,
  },
});
```

### Step 4c: Attach Proof and Submit

```typescript
const fullEvent = {
  ...event,
  proof: {
    signature,
    signer: account.address,
    domain: 'AgentReputationOracle',
    typedDataHash: dataHash,
  },
};

const response = await fetch('http://localhost:3402/v1/reputation/event', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PAYMENT': '<x402-payment-proof>',
  },
  body: JSON.stringify(fullEvent),
});

const result = await response.json();
// result.accepted === true
// result.attestation.signature = oracle's acceptance signature
```

### Constraints

- `agentId` must differ from `sourceAgentId` (no self-attestation).
- `proof.signer` must match `sourceAgentId`.
- Rate limit: 100 events per agent per hour.
- Duplicate event IDs are accepted idempotently (returns `duplicate: true`).

## 5. Verify a Receipt

When you query `GET /v1/reputation/:agentId`, the response includes a signed receipt. Verify it to confirm the oracle produced the data.

```typescript
import { verifyTypedData } from 'viem';

const receipt = response.receipt; // from the API response

const receiptTypes = {
  ReputationReceipt: [
    { name: 'agentId', type: 'address' },
    { name: 'vectorHash', type: 'bytes32' },
    { name: 'timestamp', type: 'string' },
    { name: 'totalEvents', type: 'uint256' },
  ],
};

const isValid = await verifyTypedData({
  address: receipt.oracleAddress,
  domain: {
    name: 'AgentReputationOracle',
    version: '1',
    chainId: 84532,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: receiptTypes,
  primaryType: 'ReputationReceipt',
  message: {
    agentId: receipt.agentId,
    vectorHash: receipt.vectorHash,
    timestamp: receipt.timestamp,
    totalEvents: BigInt(receipt.vector.totalEvents),
  },
  signature: receipt.signature,
});

console.log('Receipt valid:', isValid);
// Also verify: receipt.oracleAddress matches the /v1/health oracle address
```

## 6. Key Rotation

If you need to migrate to a new wallet address, use the `KeyRotation` EIP-712 type defined by the oracle.

### Sign a Key Rotation Message (from old key)

```typescript
const rotationTypes = {
  KeyRotation: [
    { name: 'oldAddress', type: 'address' },
    { name: 'newAddress', type: 'address' },
    { name: 'timestamp', type: 'string' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const rotationSignature = await oldAccount.signTypedData({
  domain: {
    name: 'AgentReputationOracle',
    version: '1',
    chainId: 84532,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: rotationTypes,
  primaryType: 'KeyRotation',
  message: {
    oldAddress: oldAccount.address,
    newAddress: newAccount.address,
    timestamp: new Date().toISOString(),
    nonce: 0n,
  },
});
```

The oracle stores the mapping in the `agents` table under `previous_addresses`. After rotation, the new address inherits the old address's identity chain but starts fresh in terms of events (events are keyed by address).

## Event Types Quick Reference

| Event Type               | When to Use                                      |
|--------------------------|--------------------------------------------------|
| `transaction_completed`  | After completing a task/transaction with an agent |
| `sla_verified`           | After measuring SLA compliance                   |
| `arbitration_result`     | After a dispute is resolved                      |
| `slash`                  | To penalize bad behavior                         |
| `attestation`            | General reputation attestation (reliability, quality, speed, communication) |

## Decision Flow for Consuming Reputation

```
1. Query GET /v1/reputation/:agentId
2. Verify the EIP-712 receipt signature
3. Check receipt.oracleAddress matches known oracle
4. Evaluate:
   - confidence > 0.3?  (enough data to trust)
   - isActive == true?   (agent recently active)
   - reliabilityScore > your threshold?
   - disputeRate < your threshold?
5. Proceed or reject the interaction
```
