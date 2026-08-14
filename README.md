# Cutout

**A privacy-liquidity router for STRK20.**

Before you sign, Cutout works out whether your amount has meaningful public cover
right now, and routes flexible transactions toward healthier exact-amount
cohorts.

Built for the [STRK20 Private Sprint](https://strk20.starknet.io/hackathon),
14 to 31 August 2026.

---

## The problem

STRK20 gives you cryptographic privacy. It does not give you operational
privacy, and StarkWare's own documentation is explicit about the gap: deposits
and withdrawals are public at the edges, and *"a distinctive amount executed
shortly after a distinctive deposit is correlatable."*

We measured how big that gap actually is across the pool's full history. The
[census](docs/CENSUS.md) separates ambient same-token traffic from exact-amount
cohorts and records every correction made to the method:

> **At signing time, the median proposed shield has 3 prior deposits of the same
> token and exact amount in the trailing 24 hours. 35% have no prior match and
> 55% have five or fewer, inside a window carrying a median of 1,984 same-token
> deposits.**

The pool is busy, but privacy liquidity is fragmented across amounts, so much of
that activity does not become exact-amount cover. Nothing in the stack tells a
user this before they sign.

## What Cutout does

It sits in the signing path. Given a proposed shield action it returns a band, the
public signals that fired, the evidence behind each, and the live cohort the
action would land in. Illustrative output:

```
Proposed: shield 4,713.22 USDC

MEDIUM LINKABILITY                                  CUTOUT-v1.3

Signals that fired:
  S1  amount appears once in the 30-day observation window
  S5  no matching deposit exists in the trailing 24h cohort

Cohort quality:
  existing matches (trailing 24h) ...... 0
  projected cohort after this shield ... 1
  traffic cohort (same token) .......... 2,104   [context only]

Recommendation:
  Your intent permits amount flexibility of +/- 2%.
  4,700.00 USDC has a live trailing cohort of 34 across 21 addresses.
  That is the smallest deviation that materially improves cover.
```

And when nothing helps, it says so rather than inventing an answer:

```
  No permitted alternative improves cover under these constraints.
```

## What Cutout does not claim

This matters more than the feature list. Cutout **never** says a transaction is
anonymous, untraceable, or unlinkable. It never reports a probability of linkage,
and it never claims to have deanonymised anything.

It reports **candidate cohorts**, which are an upper bound on what a passive
public observer can narrow an action down to, under a published threat model, and
nothing more. A real adversary with wallet telemetry, RPC metadata or exchange
records is strictly more capable.

The full adversary definition, every threshold, and an explicit non-claims
section are in **[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)**. It is
versioned, and it was frozen before any scoring code was written.

## Vocabulary

The project keeps these strictly apart, because blurring them is how privacy
tools end up lying:

| Term | Meaning |
|---|---|
| **Fingerprint** | A property of one event that makes it rare, such as an amount nobody else used. Not a linkage. |
| **Linkage signal** | A fingerprint plus a corroborating public observable. Still not proof. |
| **Traffic cohort** | Same-token events in the window. Ambient activity, shown as context only. |
| **Candidate cohort** | Same token *and same exact amount*, in a **trailing** window. What an observer doing amount reconciliation actually chooses between. This is the number we report. |

## Repository

| Path | |
|---|---|
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | CUTOUT-v1.3. Adversary, signals, constants, bands, non-claims. **Read this first.** |
| [`docs/CENSUS.md`](docs/CENSUS.md) | The pool measurement, its method, and its corrections. |
| [`scripts/pool-scan.py`](scripts/pool-scan.py) | The census. Read-only, no dependencies beyond the standard library. |
| [`docs/DAY0.md`](docs/DAY0.md) | Mainnet wallet check and receipt-verification procedure. |
| [`src/engine`](src/engine) | Deterministic CUTOUT-v1.3 shield preflight engine. |

## Running the census

```bash
CUTOUT_SCAN_HEAD=13277427 python3 scripts/pool-scan.py
```

No API key, no wallet, no viewing key. It reads public mainnet data through a
public RPC. Omit `CUTOUT_SCAN_HEAD` to scan through the latest block. Every
number in `docs/CENSUS.md` comes out of this script.

## Network

```bash
CHAIN_ID=SN_MAIN                  # 0x534e5f4d41494e
RPC_URL=https://rpc.starknet.lava.build
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
POOL_DEPLOYED_AT_BLOCK=8978970    # 2026-04-20
```

## Status

**Registered for the sprint. Exact census and threat model complete; product implementation is underway.**

- [x] Exact-timestamp full-history census, reproducible and fail-closed
- [x] `THREAT_MODEL.md` v1.3 frozen: numeric constants, action applicability, holdout, non-claims
- [x] Deterministic shield preflight engine implementing those constants
- [x] Day 0 checklist and mainnet receipt verifier
- [ ] Guard in the signing path via the Starknet Wallet API
- [ ] Guarded mainnet action with a versioned receipt
- [ ] `@cutout/guard` as an installable package

Nothing here is audited. Nothing here is a privacy guarantee.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
