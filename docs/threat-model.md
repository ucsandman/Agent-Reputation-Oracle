# Threat Model

## 1. Sybil Attacks

**Threat:** An attacker creates many identities to flood an agent with positive (or negative) reputation events.

**Mitigations:**
- **x402 payment cost.** Every event submission costs $0.01 USDC. Creating 1,000 fake attestations costs $10. This makes large-scale Sybil attacks economically unfeasible for low-value manipulation.
- **Sublinear volume weight.** The volume weight uses `ln(1 + sum(w_i))`, which grows logarithmically. Doubling the number of events does not double the volume weight. 1,000 events yield a volume weight of ~6.9, while 10 events yield ~2.4 -- only a 2.9x difference for 100x the cost.
- **Rate limiting.** Maximum 100 events per agent per hour. Sustained flooding requires time and ongoing cost.

**Residual risk:** A well-funded attacker can still influence scores over time. The cost barrier raises the economic threshold, but does not eliminate the risk entirely.

## 2. Collusion

**Threat:** Two or more agents coordinate to inflate each other's reputation through mutual positive attestations.

**Mitigations:**
- **Attester distribution discount.** The engine tracks which `sourceAgentId` submitted each event. If a single attester accounts for more than 50% of an agent's events, a 0.5x discount is applied. Above 80%, the discount drops to 0.1x. This pulls all scores toward their Bayesian priors, effectively neutralizing the colluding attester's influence.
- **Collusion discount formula:**
  ```
  adjusted = prior + (raw - prior) * discount
  ```
  At discount = 0.1, a perfect 1.0 reliability score (prior 0.5) becomes:
  ```
  0.5 + (1.0 - 0.5) * 0.1 = 0.55
  ```

**Residual risk:** Collusion rings with many participants (each contributing < 50%) can evade the distribution check. Future mitigation: graph analysis on the attester network.

## 3. Oracle Compromise

**Threat:** An attacker gains access to the oracle's private key and issues fraudulent reputation receipts or attestations.

**Mitigations:**
- **EIP-712 signed receipts are independently verifiable.** Every reputation query returns a `SignedReceipt` containing the `vectorHash`, `oracleAddress`, and EIP-712 signature. Consumers can verify the receipt off-chain without trusting the oracle at query time.
- **Deterministic recomputation.** The reputation vector is deterministically derived from the append-only event log. Any party with access to the event log can recompute and verify vectors independently.
- **Separate concerns.** The oracle's signing key is distinct from the x402 payment address. Compromising the payment wallet does not grant signing capability.

**Residual risk:** If the signing key is compromised, the attacker can produce valid-looking receipts until the key is rotated. Key rotation invalidates the old oracle address, but previously issued receipts remain valid under the old key.

**Detection:** Consumers should compare the `oracleAddress` in receipts against the value returned by `GET /v1/health`. A mismatch indicates potential compromise or key rotation.

## 4. Self-Attestation

**Threat:** An agent submits positive reputation events about itself.

**Mitigations:**
- **API-level rejection.** The events router explicitly checks `agentId === sourceAgentId` and returns `403 Self-attestation is not allowed`. This is enforced before any signature verification or storage.
- **Signature binding.** The `proof.signer` must match `sourceAgentId`. An agent cannot impersonate another attester without their private key.

**Residual risk:** None for direct self-attestation. Indirect self-attestation (creating a second identity to attest about yourself) falls under the Sybil/Collusion threat categories.

## 5. Volume Gaming

**Threat:** An agent arranges for many low-cost, low-effort attestations to inflate their volume weight and confidence score.

**Mitigations:**
- **Sublinear volume weight.** `ln(1 + sum(w_i))` means diminishing returns. Going from 10 to 100 events increases volume weight from 2.4 to 4.6 -- less than 2x for 10x the events.
- **Confidence ceiling.** `confidence = 1 - e^(-0.1 * volumeWeight)` asymptotes below 1.0. Even with 1,000 events, confidence is only ~0.50.
- **Per-event cost.** At $0.01 per event, gaming volume costs real money: $1 for 100 events, $10 for 1,000 events.
- **Collusion discount.** If the volume gaming comes from a concentrated set of attesters, the distribution discount reduces all score dimensions.

**Residual risk:** Moderate. An attacker can achieve higher confidence than legitimate but less active agents. The economic cost scales linearly while the benefit scales logarithmically, making this progressively less effective.

## 6. Event Replay / Forgery

**Threat:** An attacker replays a legitimate event or forges event data.

**Mitigations:**
- **UUID idempotency.** Each event has a UUID `id`. Duplicate IDs are detected and return `200` with `duplicate: true` instead of being re-ingested.
- **EIP-712 signature verification.** Event data is hashed and signed. The oracle verifies the signature against `proof.signer` before accepting. Modifying any field invalidates the signature.
- **Timestamp validation.** Timestamps must be valid ISO 8601. Combined with decay, old replayed events have diminished impact.

**Residual risk:** Minimal for direct replay. An attacker with a valid attester key can create unlimited new events (subject to rate limiting and cost).

## 7. Denial of Service

**Threat:** An attacker floods the API to exhaust resources or prevent legitimate access.

**Mitigations:**
- **x402 payment requirement.** Every request costs money. A sustained DoS attack requires ongoing USDC expenditure.
- **Rate limiting.** 100 events per agent per hour on the write path.
- **SQLite WAL mode.** Concurrent reads are not blocked by writes, limiting the blast radius of write-heavy attacks.

**Residual risk:** The `GET /v1/health` endpoint is free and unmetered. Standard infrastructure-level rate limiting (reverse proxy, CDN) should be applied in production.

## Summary Table

| Threat             | Primary Mitigation            | Residual Risk |
|--------------------|-------------------------------|---------------|
| Sybil attacks      | x402 payment cost             | Medium        |
| Collusion          | Attester distribution discount| Medium        |
| Oracle compromise  | EIP-712 verifiable receipts   | Medium        |
| Self-attestation   | API rejection                 | None          |
| Volume gaming      | Sublinear volume weight       | Low           |
| Event replay       | UUID idempotency + signatures | Low           |
| Denial of service  | x402 cost + rate limits       | Low           |
