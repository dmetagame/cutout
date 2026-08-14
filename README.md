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

We measured how big that gap actually is. From the pool's full history
(2026-04-20 to 2026-08-14, 15,656 deposits, [method and numbers
here](docs/CENSUS.md)):

> **At the moment of signing, the median STRK20 deposit has 4 other deposits of
> the same token and exact amount in the preceding 24 hours. 35% have none at
> all, inside a window carrying a median of 1,979 same-token deposits.**

The pool is busy. Privacy liquidity is fragmented across amounts, so almost none
of that activity is reachable as cover. Nothing in the stack tells a user this
before they sign.

## What Cutout does

It sits in the signing path. Given a proposed action it returns a band, the
public signals that fired, the evidence behind each, and the live cohort the
action would land in:

```
Proposed: withdraw 4,713.22 USDC

HIGH LINKABILITY                                    CUTOUT-v1.2

Signals that fired:
  S1  amount appears once in the 30-day observation window
  S2  a deposit of exactly 4,713.22 USDC exists in range
  S3  that deposit was 11 minutes ago
  S5  trailing 24h candidate cohort: 1

Cohort quality:
  candidate cohort (trailing 24h) ...... 1
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
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | CUTOUT-v1.2. Adversary, signals, constants, bands, non-claims. **Read this first.** |
| [`docs/CENSUS.md`](docs/CENSUS.md) | The pool measurement, its method, and its corrections. |
| [`scripts/pool-scan.py`](scripts/pool-scan.py) | The census. Read-only, no dependencies beyond the standard library. |

## Running the census

```bash
python3 scripts/pool-scan.py
```

No API key, no wallet, no viewing key. It reads public mainnet data through a
public RPC and takes roughly fifteen minutes on a cold cache. Every number in
`docs/CENSUS.md` comes out of this script.

## Network

```bash
CHAIN_ID=SN_MAIN                  # 0x534e5f4d41494e
RPC_URL=https://rpc.starknet.lava.build
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
POOL_DEPLOYED_AT_BLOCK=8978970    # 2026-04-20
```

## Status

**Registered for the sprint. Measurement and threat model complete. Product build starts 22 August.**

- [x] Full-history pool census, reproducible
- [x] `THREAT_MODEL.md` v1.2 frozen: five rated signals, numeric constants, holdout, non-claims
- [ ] Preflight engine implementing exactly those constants
- [ ] Guard in the signing path via the Starknet Wallet API
- [ ] Guarded mainnet action with a versioned receipt
- [ ] `@cutout/guard` as an installable package

Nothing here is audited. Nothing here is a privacy guarantee.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
