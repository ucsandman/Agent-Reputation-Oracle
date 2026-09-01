# Reputation Math

## Overview

The reputation vector is computed from an agent's full event history. Each event is time-weighted using exponential decay and by the standing of the attester who submitted it, and each scoring dimension uses a Bayesian average with informative priors to handle cold-start and low-data agents.

## Exponential Time Decay

Every event receives a weight based on its age:

```
weight(t) = e^(-lambda * deltaT)
```

Where:
- `deltaT` = age of event in days (`(now - eventTimestamp) / 86400000`)
- `lambda` = decay constant = `ln(2) / halfLifeDays`
- `halfLifeDays` = 90 (default)

**Properties:**
- At `deltaT = 0`: weight = 1.0 (just happened)
- At `deltaT = halfLife` (90 days): weight = 0.5
- At `deltaT = 2 * halfLife` (180 days): weight = 0.25
- Future events (negative deltaT): clamped to 1.0

**Active window:** An agent is considered "active" if their last event is within `2 * halfLifeDays` (180 days).

## Bayesian Average

All scoring dimensions (except volume) use the same weighted Bayesian average formula:

```
score = (prior_w * prior_v + SUM(w_i * x_i)) / (prior_w + SUM(w_i))
```

Where:
- `prior_w` = prior weight (pseudo-count, controls strength of prior)
- `prior_v` = prior value (default assumption before data)
- `w_i` = weight for event i = `decayWeight(i) * attesterWeight(source_i)`, then capped per attester (see below)
- `x_i` = observed value for event i (0.0 to 1.0)

The prior acts as a regularizer: with zero events, the score equals `prior_v`. As events accumulate, the prior is diluted by real data.

## Scoring Dimensions

### 1. Reliability Score

**Prior:** weight = 5, value = 0.5 (neutral assumption)

**Input events and values:**

| Event Type             | Condition                  | x_i |
|------------------------|----------------------------|-----|
| `transaction_completed`| `completedSuccessfully`    | 1.0 |
| `transaction_completed`| `!completedSuccessfully`   | 0.0 |
| `arbitration_result`   | `outcome = agent_favored`  | 1.0 |
| `arbitration_result`   | `outcome = split`          | 0.5 |
| `arbitration_result`   | `outcome = counterparty_favored` | 0.0 |
| `slash`                | `severity = minor`         | 0.2 |
| `slash`                | `severity = major/critical`| 0.0 |
| `attestation`          | `category = reliability`   | `confidence` (0-1) |

### 2. Completion Rate

**Prior:** weight = 3, value = 0.7 (optimistic assumption)

**Input events:** Only `transaction_completed`.

| Condition              | x_i |
|------------------------|-----|
| `completedSuccessfully = true`  | 1.0 |
| `completedSuccessfully = false` | 0.0 |

### 3. Dispute Rate

**Prior:** weight = 5, value = 0.05 (low dispute assumption)

**Input events:** `arbitration_result` and `transaction_completed`.

| Event Type             | x_i |
|------------------------|-----|
| `arbitration_result`   | 1.0 (is a dispute) |
| `transaction_completed`| 0.0 (not a dispute) |

Lower is better. A high dispute rate indicates frequent arbitration.

### 4. SLA Adherence

**Prior:** weight = 2, value = 0.8 (high compliance assumption)

**Input events:** Only `sla_verified`.

| Condition     | x_i |
|---------------|-----|
| `metSla = true`  | 1.0 |
| `metSla = false` | 0.0 |

### 5. Volume Weight

Not a Bayesian average. Uses sublinear (logarithmic) growth:

```
volumeWeight = ln(1 + SUM(w_i))
```

Where `w_i` is the weight for every event (all types), attester-weighted and capped like every other dimension. This prevents gaming through high-volume low-quality submissions.

**Growth curve** (assuming enough distinct full-weight attesters that no cap binds):
- 1 recent event: `ln(2)` = 0.69
- 10 recent events: `ln(11)` = 2.40
- 100 recent events: `ln(101)` = 4.62
- 1000 recent events: `ln(1001)` = 6.91

### 6. Confidence

Derived from volume weight:

```
confidence = 1 - e^(-0.1 * volumeWeight)
```

**Range:** [0, 1). Never reaches 1.0.

| Volume Weight | Confidence |
|---------------|------------|
| 0.0           | 0.000      |
| 0.69 (1 event) | 0.067    |
| 2.40 (10 events) | 0.214  |
| 4.62 (100 events) | 0.370 |
| 6.91 (1000 events) | 0.499 |

### 7. Composite Score

A single integer 0-100 for callers that want one number instead of five.

```
blend = 0.40 * reliability + 0.25 * completion + 0.20 * (1 - disputeRate) + 0.15 * slaAdherence
compositeScore = round(100 * (0.5 + (blend - 0.5) * confidence))
```

Dispute rate is inverted because lower is better. The blend is pulled toward 50 by `(1 - confidence)`, so an agent nobody has vouched for reads as "unknown" (50) rather than "good". An agent with zero events scores exactly 50.

## Attester Weighting

Every event is submitted by an attester (`sourceAgentId`). Testimony counts in proportion to the attester's own standing:

```
attesterWeight = 0.1 + 0.9 * confidence(attester) * reliability(attester)
```

The attester's own vector is computed from the attester's own events with all attesters unweighted. This is one level deep and never recurses.

- **Floor 0.1:** a brand-new wallet still counts, but only a tenth as much as a fully established one. Sybil wallets are cheap to mint and stay at the floor.
- The attester weight multiplies the decay weight, so a fresh wallet's 35 attestations carry as much evidence as 3.5 attestations from a full-weight attester.

## Attester Diversity Caps

Weighting alone is not enough: a large enough ring of fresh wallets still adds up. So each attester's total contribution to a dimension is capped:

```
cap = min(8 * attesterWeight, 0.5 * totalWeightForThatDimension)
```

An attester over its cap has all of its events for that dimension scaled down proportionally.

- **8 events-worth, scaled by attester weight.** Three fresh wallets (weight 0.1) contribute at most `3 * 0.8 = 2.4` against a reliability prior of 5, which is not enough to move the score or to raise confidence above 0.12. One well-established attester (weight ~0.9) still contributes 7.2, which does carry a real score.
- **50% of a dimension's evidence.** No single attester is ever more than half the story, however good its own standing.

Together these mean a high score requires several credible attesters. This replaces the earlier max-share collusion discount, which penalised honest repeat business (an agent with 100 successful transactions from one loyal customer was pulled down to 0.55) while letting a sybil ring through (three throwaway wallets posting 35 attestations reached 0.94). Under the current rules those two cases score 0.80 and 0.66.

## Worked Example

**Scenario:** Agent `0xABC...` has 3 events, all recent (weight ~= 1.0):

1. `transaction_completed`, success = true (w=1.0, x=1.0)
2. `transaction_completed`, success = true (w=1.0, x=1.0)
3. `sla_verified`, metSla = true (w=1.0, x=1.0)

Event 1 is from attester X; events 2 and 3 are from attester Y. Both are established, so both carry `attesterWeight = 1.0`.

**Reliability** (prior_w=5, prior_v=0.5):
Only events 1 and 2 contribute.
```
score = (5 * 0.5 + 1.0 * 1.0 + 1.0 * 1.0) / (5 + 1.0 + 1.0)
      = (2.5 + 2.0) / 7.0
      = 4.5 / 7.0
      = 0.643
```

**Completion Rate** (prior_w=3, prior_v=0.7):
Events 1 and 2 contribute.
```
score = (3 * 0.7 + 1.0 * 1.0 + 1.0 * 1.0) / (3 + 1.0 + 1.0)
      = (2.1 + 2.0) / 5.0
      = 4.1 / 5.0
      = 0.820
```

**Dispute Rate** (prior_w=5, prior_v=0.05):
Events 1 and 2 contribute (as non-disputes).
```
score = (5 * 0.05 + 1.0 * 0.0 + 1.0 * 0.0) / (5 + 1.0 + 1.0)
      = 0.25 / 7.0
      = 0.036
```

**SLA Adherence** (prior_w=2, prior_v=0.8):
Event 3 is the only SLA event, so Y is 100% of this dimension's evidence and is capped at 50% of it (`0.5 * 1.0 = 0.5`).
```
score = (2 * 0.8 + 0.5 * 1.0) / (2 + 0.5)
      = (1.6 + 0.5) / 2.5
      = 2.1 / 2.5
      = 0.840
```

**Volume Weight:**
Y supplied 2 of the 3 events, so Y is capped at `0.5 * 3.0 = 1.5`; X's single event passes through.
```
volumeWeight = ln(1 + 1.0 + 1.5) = ln(3.5) = 1.253
```

**Confidence:**
```
confidence = 1 - e^(-0.1 * 1.253) = 1 - e^(-0.1253) = 1 - 0.882 = 0.118
```

**Composite Score:**
```
blend = 0.40 * 0.643 + 0.25 * 0.820 + 0.20 * (1 - 0.036) + 0.15 * 0.840 = 0.781
composite = round(100 * (0.5 + (0.781 - 0.5) * 0.118)) = 53
```

**Final vector:**
```json
{
  "reliabilityScore": 0.643,
  "completionRate": 0.820,
  "disputeRate": 0.036,
  "slaAdherence": 0.840,
  "volumeWeight": 1.253,
  "totalEvents": 3,
  "compositeScore": 53,
  "confidence": 0.118
}
```

Interpretation: Good early signals, but low confidence due to limited history and only two attesters.
