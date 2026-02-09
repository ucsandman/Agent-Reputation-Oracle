# Reputation Math

## Overview

The reputation vector is computed from an agent's full event history. Each event is time-weighted using exponential decay, and each scoring dimension uses a Bayesian average with informative priors to handle cold-start and low-data agents.

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
- `w_i` = decay weight for event i
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

Where `w_i` is the decay weight for every event (all types). This prevents gaming through high-volume low-quality submissions.

**Growth curve:**
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

## Collusion Discount

After computing raw scores, a collusion discount is applied based on attester distribution.

**Attester concentration:** For each agent, count events per `sourceAgentId`. The maximum ratio is `max(count_i / totalEvents)`.

| Max Ratio | Discount Factor |
|-----------|-----------------|
| > 0.8     | 0.1 (heavy penalty) |
| > 0.5     | 0.5 (moderate penalty) |
| <= 0.5    | 1.0 (no penalty) |

**Application:** The discount pulls each score toward its prior:

```
adjusted = prior + (raw - prior) * discount
```

At `discount = 1.0`, the score is unchanged. At `discount = 0.1`, the score moves 90% toward the prior.

## Worked Example

**Scenario:** Agent `0xABC...` has 3 events, all recent (weight ~= 1.0):

1. `transaction_completed`, success = true (w=1.0, x=1.0)
2. `transaction_completed`, success = true (w=1.0, x=1.0)
3. `sla_verified`, metSla = true (w=1.0, x=1.0)

Events are from 2 different attesters (60/40 split), so collusion discount = 1.0.

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
Event 3 contributes.
```
score = (2 * 0.8 + 1.0 * 1.0) / (2 + 1.0)
      = (1.6 + 1.0) / 3.0
      = 2.6 / 3.0
      = 0.867
```

**Volume Weight:**
```
volumeWeight = ln(1 + 1.0 + 1.0 + 1.0) = ln(4) = 1.386
```

**Confidence:**
```
confidence = 1 - e^(-0.1 * 1.386) = 1 - e^(-0.1386) = 1 - 0.871 = 0.129
```

**Final vector:**
```json
{
  "reliabilityScore": 0.643,
  "completionRate": 0.820,
  "disputeRate": 0.036,
  "slaAdherence": 0.867,
  "volumeWeight": 1.386,
  "totalEvents": 3,
  "confidence": 0.129
}
```

Interpretation: Good early signals, but low confidence due to limited history.
