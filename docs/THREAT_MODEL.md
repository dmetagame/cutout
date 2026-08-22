# CUTOUT-v1 threat model

**Version 1.3. Frozen 2026-08-14, before any scoring code was written.**

Every threshold in this document is a fixed number, here, now. Nothing is
deferred to a config file "to be declared later"; a rule set that is still
adjustable is not fixed, and a score produced under an adjustable rule set is
not worth reporting. `src/engine/constants.ts` contains exactly these constants
and a test asserting they match this document.

If any number below changes, the version changes, and every score states the
version it was produced under.

Read [§7 Non-claims](#7-non-claims) first if you read nothing else.

---

## 1. Adversary

**A passive public observer with full access to the Starknet mainnet archive.**

The adversary can read every historical block, transaction and event; can index
the complete public event history of the STRK20 pool; and can correlate freely
across tokens, addresses, amounts and block times.

The adversary does **not** control relayers, hold any viewing key, or possess
wallet telemetry, RPC logs, exchange records, or off-chain identity. It breaks no
cryptography.

This is deliberately the **weakest interesting adversary**: the one every observer
already is. Any real adversary is strictly more capable, so a HIGH rating is a
floor on risk, never a ceiling. A LOW rating says only that this adversary's
published rules did not fire.

## 2. What the adversary reads

Confirmed against the deployed pool
`0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
(deployed block 8,978,970, 2026-04-20).

| Artifact | Fields |
|---|---|
| `Deposit` | depositor address, token, amount, block |
| `Withdrawal` | recipient address, token, amount, block |
| `ViewingKeySet` | registering address, escrowed key blob, block |
| `UseNote` | published nullifier, block |
| Open notes | token and filled amount, plaintext |
| Transaction envelope | submitting relayer, nonce, gas, block time |

## 3. What the adversary cannot read

Note contents; the sender, recipient or amount of any note-to-note transfer;
which note a nullifier retires; any viewing key; and which deposit funded which
withdrawal **except by inference from §2**.

That final clause is the entire subject of this document.

## 4. Vocabulary

These three words are not interchangeable and the product must never blur them.

| Term | Meaning |
|---|---|
| **Fingerprint** | A property of a single event that makes it rare, e.g. an amount no one else used. Says nothing about linkage on its own. |
| **Linkage signal** | A fingerprint plus a corroborating public observable. Still not proof of linkage. |
| **Traffic cohort** | Count of same-token events in the cohort window. Ambient activity. **Not a candidate set.** |
| **Candidate cohort** | Count of same-token events with the **same exact public amount** in the **trailing** cohort window. What an observer performing amount reconciliation actually chooses between. Always ≤ traffic cohort, usually far smaller. Reported with its quality breakdown (§5.2), because a count produced by one actor is not cover. |

An observer sees the amount. Twenty-five differently-sized deposits are not
twenty-five candidates for an exact-amount reconciliation, they are one. **The
candidate cohort is the number the product reports.** The traffic cohort is shown
only as context, labelled as such.

## 5. Constants

Fixed, and expressed in **time**, never in blocks.

Starknet block time moved from ~2.60 s to ~1.68 s over this pool's history, so a
fixed block offset spans different real durations at different points: the
"±52,048 block" window in a previous draft of this document meant 24 hours
recently and 37.6 hours in April. Every window below is evaluated directly
against actual block timestamps.

| Constant | Value | Meaning |
|---|---|---|
| `W_OBSERVATION` | 30 days (2,592,000 s) | Rolling range over which rarity and cohorts are computed |
| `T_COHORT` | 24 hours (86,400 s), **trailing** | Cohort window for S5. Trailing, not centred: see §5.1 |
| `T_PROXIMITY` | 60 minutes (3,600 s) | Deposit-to-withdrawal delta considered tight, for S3 |
| `T_CHANNEL` | 30 minutes (1,800 s) | Channel-open to deposit delta for S4 (same transaction always fires) |
| `K_THIN` | 5 | Candidate cohort at or below this is thin, for S5 |
| `Q_MIN_ADDRESSES` | 3 | A cohort drawn from fewer distinct depositors than this is not cover |
| `Q_MAX_TOP_SHARE` | 0.50 | If one address contributed more than half the cohort, it is not cover |
| `Q_MAX_BURST_SHARE` | 0.60 | If more than this share of an amount's uses inside `W_OBSERVATION` fall in one 24h window, its popularity is a campaign artifact, not standing cover |
| `Q_MIN_DAYS` | 7 | An amount used on fewer distinct UTC dates inside `W_OBSERVATION` has no durable cover |
| `AMOUNT_TOLERANCE` | 0 | S2 requires **exact** equality. v1 has no fuzzy matching. |

### 5.1 No lookahead

`T_COHORT` is **trailing**: for an action at time *t*, the cohort counts only
events in `[t - 24h, t)`. A centred window uses events that did not exist when
the user signed, and a preflight number computed from the future is not a
preflight number.

Retrospective centred figures may appear in research output such as the census,
clearly labelled. They must never reach the product's rating path.

### 5.2 Cohort quality, not just cohort count

A count is not cover if one actor produced it. Cutout separates current cover
from historical durability rather than forcing every quality measure into the
same window.

For the live trailing `T_COHORT`, Cutout computes and displays:

- distinct depositor addresses in the cohort
- distinct transactions
- share contributed by the single busiest address

For the same `(token, amount)` inside `W_OBSERVATION`, Cutout computes:

- distinct UTC dates with at least one deposit
- the largest share of deposits falling inside any one 24-hour interval

A cohort failing `Q_MIN_ADDRESSES`, exceeding `Q_MAX_TOP_SHARE`, falling below
`Q_MIN_DAYS`, or exceeding `Q_MAX_BURST_SHARE` is reported as **low quality** and
counts as thin for S5 regardless of its raw size.

**Empirically, burst is the binding constraint in this pool, not top-address
share.** Measured over full history, the ten most-used deposit amounts draw from
42 to 782 distinct addresses and no single address exceeds 6% of any of them, so
a top-share test alone passes everything. But burst concentration reaches 100%,
99%, 98% and 95% on four of those ten: the amount was used hundreds of times by
hundreds of *different* addresses, all inside a single 24-hour window, and never
again. That is an airdrop or campaign artifact.

Consequence: an amount's lifetime popularity says almost nothing about whether it
offers cover today. Recommendation 2 therefore requires both a healthy **live
trailing cohort** and durable use inside the bounded 30-day observation window.
It never recommends an amount from lifetime counts alone.

## 6. Signals

Five signals feed the rating. One further signal is held out entirely (§6.2).

| ID | Signal | Fires when | Evidence shown |
|---|---|---|---|
| **S1** | Unique-amount fingerprint | The `(token, amount)` pair occurs exactly once within `W_OBSERVATION` | the amount and its occurrence count |
| **S2** | Amount reconciliation | A counterpart event of the same token has an **exactly** equal amount within `W_OBSERVATION` | both blocks and the shared amount |
| **S3** | Temporal proximity | Deposit-to-withdrawal delta ≤ `T_PROXIMITY` | delta in blocks and minutes |
| **S4** | Channel-open proximity | `ViewingKeySet` or channel-open for this address in the same transaction as, or within `T_CHANNEL` of, the deposit | both blocks and the delta |
| **S5** | Thin or low-quality candidate cohort | Trailing candidate cohort ≤ `K_THIN`, **or** it fails the quality tests in §5.2 | the cohort count, its quality breakdown, the window, and the traffic cohort as context |

### 6.1 Action applicability

Signals are not silently treated as absent when the proposed action does not
expose the artifact they measure. They are marked **not applicable**.

The first executable CUTOUT-v1.3 scorer supports **shield preflight** only:

| Signal | Shield preflight |
|---|---|
| S1 | Applies to the projected public `Deposit` amount |
| S2 | Not applicable: a prior withdrawal cannot be funded by a future deposit |
| S3 | Not applicable for the same causal reason |
| S4 | Applies when the shielding address recently registered or opened its channel |
| S5 | Applies to prior deposits in the trailing cohort and 30-day durability window |

Withdrawals, swaps, and private transfers require action-specific causal rules.
Until those rules are versioned, the engine returns `UNSUPPORTED_ACTION`; it
does not manufacture a LOW rating from signals that could not fire.

**Bands, assigned by fixed rule over S1–S5 only:**

| Band | Rule |
|---|---|
| **HIGH** | three or more of S1–S5 fire, **or** S2 and S3 both fire |
| **MEDIUM** | exactly two fire |
| **LOW** | zero or one fires |

### 6.2 S6 is fully outside the rating

**S6, conservation of value:** a set of withdrawals sums exactly to a single
in-range deposit of the same token.

S6 **does not enter the band**, does not enter any recommendation, and is not
computed during preflight. It runs **only after execution**, as a periodic audit
of transactions Cutout previously rated, and its results are published as a
scorecard on Cutout's own recommendation quality.

This is the point of a holdout. If S6 influenced the live rating it would just be
a sixth signal, and the earlier draft of this document made exactly that mistake
by counting "three or more signals" across all six.

A holdout still does not solve self-reference. §7 covers what remains.

## 7. Non-claims

Cutout does not claim, anywhere in its interface, README, receipts or pitch:

- that any transaction is **anonymous**, **untraceable**, or **cannot be linked**
- that any transaction **has been** or **could be** deanonymised in reality
- any **probability** of linkage or calibrated statistical confidence
- an **anonymity set**. It reports a *candidate cohort*: a count of public
  artifacts consistent with an action under this model, and an **upper bound**,
  since a real analyst prunes with knowledge Cutout does not have
- that indicators are **calibrated against ground truth**. There is none for
  private transfers. They are calibrated only against **observed mainnet
  frequency distributions**, which says how unusual something looks, not whether
  anyone has linked it
- that a LOW rating protects against an adversary with wallet telemetry, RPC
  metadata, exchange records, or auditor disclosure

**On self-reference.** Cutout both suggests executions and rates them. Three
constraints limit the circularity: the rule set is frozen and published before
evaluation (§5, §6); the recommendation policy is a fixed enumerated list (§8),
not a search over whatever scores best; and S6 is held out of the live path
(§6.2). None of this makes a LOW rating a guarantee. A LOW rating means the
published rules did not fire. That is all it has ever meant.

## 8. Recommendations, and preserving intent

A safer execution is not automatically an equivalent one. Withdrawing 5,000 USDC
to a public address and privately transferring it to a registered recipient are
different outcomes, and swapping one for the other without permission is a
product that does not do what it was asked.

Every analysis therefore takes a structured intent:

```ts
Intent {
  action:      "shield" | "private_transfer" | "withdraw" | "swap"
  token:       Address
  amount:      { mode: "exact" }
             | { mode: "flexible", target: bigint, min: bigint, max: bigint }
  destination: { kind: "public_address", value: Address }
             | { kind: "registered_recipient", value: Address }
             | { kind: "none" }
  deadline:    BlockNumber
  permitted:   Action[]        // substitutions the user has authorised
}
```

Recommendations come from a fixed list, and each is offered **only** when the
intent permits it:

| # | Recommendation | Requires |
|---|---|---|
| 1 | Use a private transfer to a registered recipient instead of a public withdrawal | `"private_transfer" ∈ permitted` and destination is registered |
| 2 | Change the amount to one with a healthy **live trailing** cohort (specific amounts shown, with their quality breakdown) | `amount.mode === "flexible"` and the value lies in `[min, max]` |
| 3 | Wait for a larger candidate cohort (current cohort and threshold shown) | the wait fits inside `deadline` |
| 4 | Separate channel setup from the value movement | S4 fired and setup is not yet on-chain |
| 5 | **No sufficiently private execution is available under these constraints** | always available |

**Option 5 is a first-class outcome.** If no recommendation satisfies the intent,
Cutout says so and stops. It does not relax the user's constraints to produce an
answer, and it does not present a non-equivalent action as if it were equivalent.

**Recommendation 2 minimises deviation.** Where the user has authorised amount
flexibility, Cutout selects the **smallest acceptable deviation that materially
improves current cohort quality**, not the most popular amount in history. An
amount used 403 times since April may have no company today; only the live
trailing cohort counts. Changing a user's amount is a real cost to them, and the
product must never describe it as free.

## 9. Known limitations

- **Bounded window.** Signals are computed over `W_OBSERVATION`. An adversary
  with longer memory sees more. The range is printed with every score.
- **Cohorts are upper bounds.** A real analyst prunes candidates using knowledge
  Cutout lacks, so true cohorts are smaller than reported.
- **Dust distorts cohorts.** Many pool withdrawals are very small; a cohort of
  tiny transfers offers little cover to a large one. Sizes are reported per token.
- **Cutout cannot create cover traffic.** It can only steer toward cover that
  already exists. Where none exists, recommendation 5 applies.
- **Private DeFi legs are not scored in v1.** Swap and lend amounts and their
  timing are public and are a further leak surface.
- **Relayer-level analysis is not scored in v1.** Submission patterns of shared
  relayers may carry signal.

## 9.1 CUTOUT-v1.4 release addendum

`CUTOUT-v1.3` above remains frozen and replayable. Release v0.2.0 adds a named
`CUTOUT-v1.4` successor; these additions do not change the v1.3 constants,
outputs, or policy mapping.

The release adds a second public edge for analysis:

- `Withdrawal` observations retain only recipient, token, amount, block, and
  transaction provenance. Encrypted payloads are discarded.
- For a typed withdrawal, S2 fires when a same-token `Deposit` has an exactly
  equal amount in the observation window. S3 fires when that counterpart
  deposit is within `T_PROXIMITY` of the proposed withdrawal.
- S2 and S3 remain `NOT_APPLICABLE` for a future shield deposit. S4 remains
  specific to the shield/account channel-open relationship.

The release adds S7, a deterministic round-amount fingerprint: an amount
with at most two displayed decimal places and no prior exact cohort. S7 is a
preflight signal and is not S6. S6 remains a post-execution conservation-of-
value holdout and does not enter any band or recommendation.

When the current cohort is thin or burst-dominated and the deadline leaves at
least one cohort window, v1.4 may return `WAIT`. This is advisory only: Cutout
does not schedule a later check, create traffic, or submit anything. An
in-bounds `CHANGE_AMOUNT` remains user-selected and receives a new exact
preflight before the deposit wallet path can proceed.

The release's cover ledger reports trailing exact-amount cohorts, traffic
context, durability checks, and snapshot provenance from the same complete
snapshot. It never calls those cohorts anonymity sets and does not expose raw
actors. Withdrawal analysis stops before wallet simulation and submission.

The v0.2.0 production target is `https://cutout.rouma.online`. Deployment
identity is recorded only after the separate CUTOUT-v1.4 smoke passes. The
v0.1.4 / CUTOUT-v1.3 record remains historical evidence.

## 10. Changelog

| Version | Date | Change |
|---|---|---|
| 1.3 | 2026-08-14 | Separated live 24-hour cohort quality from 30-day durability so `Q_MIN_DAYS` is measurable, and limited the first executable scorer to shield preflight. Unsupported action types now fail closed instead of receiving misleading LOW ratings from inapplicable signals. |
| 1.2 | 2026-08-14 | Added `Q_MAX_BURST_SHARE` and `Q_MIN_DAYS` after the census showed burst concentration, not top-address share, is the binding cohort-quality constraint: four of the ten most-used amounts have 95-100% of their lifetime uses inside a single 24h window despite drawing on 42-109 distinct addresses. |
| 1.1 | 2026-08-14 | All windows expressed in **time**, not blocks (block time moved 2.60s → 1.68s across pool history, so fixed block offsets were spanning inconsistent durations). `T_COHORT` is now explicitly **trailing**, removing lookahead from the rating path. Added cohort-quality tests (`Q_MIN_ADDRESSES`, `Q_MAX_TOP_SHARE`) so a cohort produced by one actor no longer counts as cover. S5 fires on thin **or** low-quality. Recommendation 2 now minimises deviation against the live trailing cohort rather than pointing at historically popular amounts. |
| 1.0 | 2026-08-14 | Frozen. Five rated signals with numeric thresholds, S6 fully held out of the live path, candidate cohort separated from traffic cohort, intent-preserving recommendation gating. |
