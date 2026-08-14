# STRK20 pool census

Measured 2026-08-14 against Starknet mainnet, full pool history, timestamp-based.
Reproduce with `python3 scripts/pool-scan.py`. Read-only; no keys, no wallet, no
viewing key.

This document exists because Cutout's entire premise is a claim about the pool,
and a claim about the pool should be checkable by the person reading it.

---

## 1. Method

| | |
|---|---|
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Deployed | block **8,978,970**, 2026-04-20 10:08:48 UTC |
| Head at scan | block 13,277,427 |
| Span | **116.0 days**, average block time **2.333 s** |

Four method rules, each of which we got wrong first and had to fix:

1. **Find genesis by binary search** over `starknet_getClassHashAt`. Pool activity
   is lumpy: one 200k-block window holds 34 events while its older neighbour
   holds 412. Scanning back "until an empty window" truncates the history.
2. **Use block timestamps, never a constant block rate.** Starknet block time
   moved from ~2.60 s to ~1.68 s across this pool's life. A fixed ±52,048-block
   window means 24 hours today and 37.6 hours in April.
3. **Non-overlapping windows, no deduplication.** Deduping on event shape would
   collapse two legitimate identical deposits made in one multicall.
4. **Trailing windows, not centred**, for anything that claims to describe what an
   observer knows at signing time. A centred window counts the future.

## 2. The pool

| Measure | Value |
|---|---|
| Pool events | 112,143 |
| Addresses that registered a viewing key | 2,387 |
| Deposits | 15,656 (135/day) |
| Distinct depositor addresses | 2,362 |
| Withdrawals | 38,172 (329/day) |
| Deposits by token | STRK 8,153 · USDC 5,917 · strkBTC 1,228 · ETH 151, plus a long tail |
| Distinct (token, amount) pairs | 4,625 |
| Deposits with an amount unique in range | 3,668 / 15,656 = 23% |

That last row is a **fingerprint frequency**: a property of a single event. It is
not a demonstrated linkage, and this project never calls it one. See
[`THREAT_MODEL.md`](./THREAT_MODEL.md) §4.

## 3. Three cohort measures

| Cohort | p25 | median | p75 | ≤5 | alone |
|---|---|---|---|---|---|
| **Traffic** — same token, ±24h | 641 | 1,979 | 2,396 | 2% | 1% |
| **Candidate** — same token + exact amount, ±24h *(retrospective)* | 1 | 10 | 63 | 43% | 28% |
| **Candidate, trailing 24h** — *the preflight number* | 1 | **4** | 27 | **53%** | **35%** |

An observer performing amount reconciliation sees the amount. Two thousand
differently-sized deposits are not two thousand candidates; they are one. And at
the moment a user signs, the future has not happened yet, so only the trailing
row describes what is actually knowable.

> **At the moment of signing, the median STRK20 deposit has 4 other deposits of
> the same token and exact amount in the preceding 24 hours. 35% have none at
> all, and 53% have five or fewer, inside a window carrying a median of 1,979
> same-token deposits.**

The pool is busy. Privacy liquidity is fragmented across amounts, so very little
of that activity is reachable as cover.

## 4. Cohort quality: popularity is not cover

A raw count says nothing about whether an amount offers durable cover. For each
of the ten most-used deposit amounts:

| Amount | Uses | Addrs | Days | Top addr | Burst |
|---|---|---|---|---|---|
| 4 STRK | 787 | 782 | 78 | 1% | 48% |
| 51 USDC | 403 | 109 | 4 | 2% | **99%** |
| 3,000 STRK | 395 | 100 | 8 | 6% | 84% |
| 61 USDC | 292 | 78 | 3 | 3% | **95%** |
| 41 USDC | 247 | 97 | 3 | 2% | **98%** |
| 2,000 STRK | 229 | 78 | 9 | 5% | 73% |
| 0.000016 strkBTC | 188 | 187 | 10 | 1% | 72% |
| 1,500 STRK | 176 | 87 | 7 | 3% | 85% |
| 1 USDC | 173 | 102 | 30 | 6% | 39% |
| 1,760 STRK | 166 | 42 | 1 | 4% | **100%** |

*Addrs = distinct depositors. Days = distinct UTC days. Top addr = share from the
single busiest address. Burst = largest share of lifetime uses falling inside any
one 24h window.*

**No single address exceeds 6% of any cohort.** A top-address concentration test
therefore passes all ten and detects nothing. The real failure mode is **burst**:
four of these amounts have 95% to 100% of their lifetime uses inside a single
24-hour window, contributed by dozens or hundreds of *different* addresses. Those
are airdrop or campaign artifacts, not standing cover.

Only **4 STRK** (782 addresses across 78 days) and **1 USDC** (102 addresses
across 30 days) show durable, distributed cover.

**Consequence for the product:** an amount's lifetime popularity says almost
nothing about whether it offers cover today. Only the live trailing cohort does.
This is why Cutout's amount recommendations are computed against the live
trailing cohort and never against historical counts, and why
[`THREAT_MODEL.md`](./THREAT_MODEL.md) §5.2 tests burst concentration.

## 5. Corrections

Earlier drafts of this census were wrong four times. Each error is recorded
because the failure mode is instructive, and because a number you cannot audit is
not evidence.

| Claim | Status |
|---|---|
| "Registered users, all-time: 222" | Wrong. A 31-day window mislabelled as all-time. True figure 2,387. |
| "44% of deposits linkable by amount alone" | Wrong twice. Full-history fingerprint rate is 23%, and a fingerprint is not a linkage. |
| "Median anonymity set 25" | Wrong term and wrong number. Not an anonymity set. |
| "82.5 days, 190 deposits/day" | Wrong. A 1.66 s block time, sampled from recent blocks, applied to a history averaging 2.333 s. |
| Cohorts over a fixed ±52,048-block window | Wrong. That window spanned 24h recently and 37.6h in April, inflating early cohorts. |
| Centred ±24h cohort as the headline | Wrong for preflight. It counts events that did not exist at signing time. |
| "Amounts with real company: 51 USDC, 403 uses" | Wrong. 99% of those uses fell inside one 24h window. |

Every one came from a shortcut in measurement rather than an error in reasoning:
a convenient window, a constant sampled from the wrong era, a centred window that
peeked at the future, a popularity count that ignored *when*.
