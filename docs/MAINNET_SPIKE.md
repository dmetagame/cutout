# Milestone 1: mainnet shield-preflight spike

**Run dates:** 2026-08-14 (public data), 2026-08-16 (real browser wallet)
**Status:** complete; public-data, engine, and real-wallet simulation boundaries verified
**Model:** `CUTOUT-v1.3`
**Freshness policy:** `FRESHNESS_POLICY-v1`
**Guard policy:** `GUARD_POLICY-v1`

This spike tests only the two risky integration boundaries needed before the
production indexer or signing UI: public STRK20 mainnet ingestion into the
unchanged deterministic engine, and a narrow Starknet Wallet API adapter for a
single deposit action.

> **NO TRANSACTION WAS SUBMITTED.**

## Configuration

| Item | Value |
|---|---|
| Chain | Starknet mainnet (`SN_MAIN`) |
| Chain ID | `0x534e5f4d41494e` |
| RPC | `https://rpc.starknet.lava.build` |
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Pool deployment block | `8,978,970` |
| Reviewed class hash | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| Starknet library | `starknet.js 10.4.0` |
| Required Wallet API | `0.10.3` or newer |

Network addresses are normalized as Starknet addresses at the configuration
boundary. They are never accepted as arbitrary per-request pool addresses.

## ABI provenance

[`fixtures/pool-abi.json`](../fixtures/pool-abi.json) is a reviewed projection
of the two public event schemas Cutout consumes. It was retrieved from the live
class at block `13,299,711` using `starknet_getClassHashAt` and
`starknet_getClass`.

The live spike re-read the pool class hash and class ABI at the captured source
head, then compared the reviewed struct/event entries field by field before
reading events. Selectors are derived from the ABI event leaf names with
`starknet.js`; they are not parser constants:

| Event | Selector | Retained public fields |
|---|---|---|
| `Deposit` | `0x9149d2123147c5f43d258257fef0b7b969db78269369ebcf5ebb9eef8592f2` | depositor, token, amount |
| `ViewingKeySet` | `0x1321a492485b4f19851fb787ab3800a0030b595332cba93cd5fe40dfb5a4daf` | registering account only |

The `ViewingKeySet.public_key` key and three-felt encrypted-key payload are used
only to validate the ABI-defined event width. They are not parsed, normalized,
returned, logged, or stored.

## Live mainnet result

Command:

```bash
npm run spike:mainnet
```

The run queried a bounded source covering the model's 30-day horizon plus a
10-minute boundary buffer. It did not scan the pool's full history.

| Field | Live value |
|---|---|
| Source range | blocks `11,897,847..13,301,545` |
| Source-from timestamp | `1,784,154,072` |
| Observed/indexed-through block | `13,301,545` |
| Observed/indexed-through hash | `0x45acfeced5b9e610aebdd768daf7942eef63b49f02b05e329d508fce0ec18b6` |
| Observed timestamp | `1,786,746,667` (`2026-08-14 22:31:07 UTC`) |
| RPC head block | `13,301,571` |
| RPC head hash | `0x438467637d178df22689104ab4ec68a72c76bf121fd09345c1ff6ed50f34dee` |
| RPC head timestamp | `1,786,746,710` (`2026-08-14 22:31:50 UTC`) |
| Source age at evaluation | 52 seconds |
| Index lag | 43 seconds |
| Completed RPC pages | 39 |
| Decoded deposits | 607 |
| Decoded registrations | 202 |

Both ages passed the frozen 120-second limits. All non-overlapping ranges and
continuation pages completed, both required selectors were queried, the source
and RPC heads had valid parent links, and every event-bearing block received an
exact header.

One earlier invocation received `Block not found` from the RPC while fetching
an event-bearing block header. It terminated with `RPC_ERROR` and
`FAILED_CLOSED`; no preflight band or guard decision was emitted. A clean rerun
produced the result above.

Example decoded `Deposit` provenance:

```text
block       13,299,933
block hash  0x7ce4bc89a38d51e20eb96a10aef386035deed0ab73423af0a4f2a3857ba425d
timestamp   1,786,743,967
tx hash     0x1042873584b8fcff4f251414e2a6f77446a7020110098cb1e19d8f850ef0f75
event index 808
token       STRK
amount      10000000000000000000 base units
```

Example decoded `ViewingKeySet` provenance:

```text
block       13,298,812
block hash  0x576227dab822daf749d9f5e251a626983dfcd212501ed2a28cc7ebf76046b07
timestamp   1,786,742,077
tx hash     0x38e901b1597ffc22360b069bd904baea775b8544efa096bb49a7d8d3e505b53
event index 805
```

No public key or encrypted-key payload appears in the normalized registration.

## Snapshot boundary

`PublicSnapshot` contains:

- chain, pool, class, and reviewed-fixture identity;
- observed, indexed-through, RPC-head, source-boundary, and parent references;
- exact hashes and timestamps for every retained event block;
- completed-source and queried-selector declarations;
- normalized `Deposit` and registration observations with transaction/event
  provenance;
- engine and freshness-policy versions.

It contains no wallet balance, private note, viewing key, proof secret, private
key, seed phrase, or encrypted viewing-key payload. Canonical key ordering and
observation ordering produced this SHA-256 snapshot identifier:

```text
0x95db52987a08c952ef7eae199865c09503f439df163b72d5a9e39a75fa6a6e72
```

The test suite proves the hash is stable under input array ordering and changes
when normalized snapshot content changes.

The later real-wallet verification consumed a fresh snapshot through the same
boundary at block `13,387,121`:

```text
observed/indexed hash  0x26588e27a8b5e6fc020820cdf7f4004a9ea476d41d0f96077e4789aa65b49ab
observed timestamp     2026-08-16 13:52:22 UTC
RPC head               13,387,149
RPC head timestamp     2026-08-16 13:53:08 UTC
snapshot hash          0xdecfd99f17ef7a6efd04afca17939e42faca2daf5ed9c9b454f63d944c76b6a1
source age             51 seconds
index lag              46 seconds
```

Both freshness values passed `FRESHNESS_POLICY-v1`.

## Engine result

The CLI selected the most recent supported public deposit as a sample intent:
10 STRK in base units, with explicit +/-2% bounds. The unchanged engine returned:

| Field | Result |
|---|---|
| Status | `AVAILABLE` |
| Model | `CUTOUT-v1.3` |
| Band | `LOW` |
| Operational decision | `ALLOW` |
| Prior exact deposits in 30 days | 18 |
| Existing trailing exact matches | 4 |
| Projected cohort | 5 |
| Same-token traffic events | 11 |
| Distinct cohort addresses | 2 |
| Top-address share | 0.80 |
| Fired signal | `S5` |
| Recommendation | `NO_SAFER_EXECUTION` inside the authorized range |

`LOW` means only that one of the five published signals fired. It is not an
anonymity, unlinkability, or deanonymization-probability claim.

The typed Wallet API action was:

```json
{
  "type": "deposit",
  "token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "amount": "0x8ac7230489e80000"
}
```

No arbitrary calldata or alternate STRK20 action entered the adapter.

## Wallet and simulation result

Milestone 1A was run on 2026-08-16 in Chrome 151 through an approved local
Playwright CDP connection. The installed wallet was Ready X `5.33.8`.

Ready X did not emit a native Wallet Standard registration event on the harness
page, so discovery used the injected-wallet fallback. This is not a virtual or
mock wallet: the fallback wrapped the real `window.starknet_argentX` provider in
the same Wallet Standard feature shape used by
`@starknet-io/get-starknet-discovery`'s `StarknetInjectedWallet` path.

Capability negotiation returned:

| Field | Verified value |
|---|---|
| Supported Wallet APIs | `0.10.3`, `0.7.2` |
| Selected Wallet API | `0.10.3` |
| Chain | `0x534e5f4d41494e` (`SN_MAIN`) |
| Account | `0x5854e275d709627eb88a95519326c528f8c5dc402d350d29e72dbcaf48b434f` |
| Account implementation | `_WalletAccountV6` |

The browser consumed the fresh public snapshot above, ran the unchanged
`CUTOUT-v1.3` engine, applied `GUARD_POLICY-v1`, and constructed exactly one
deposit action:

```json
{
  "type": "deposit",
  "token": "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "amount": "0x2386f26fc10000"
}
```

The result was `LOW` / `ALLOW`. Signal `S5` fired because the projected cohort
was unhealthy: 2 existing exact matches, projected cohort 3, 2 distinct
addresses, top-address share 2/3, and 3 active days. The exact intent permitted
no amount change, so the recommendation was `NO_SAFER_EXECUTION`. `LOW` retains
only the meaning defined by the frozen model and is not an anonymity claim.

The real account then executed only:

```ts
account.strk20PrepareInvoke([depositAction], true)
```

Ready X returned a simulation preparation for pool entrypoint `apply_actions`
with 16 calldata felts and an empty proof. The observed Wallet API request types
were:

```text
wallet_supportedWalletApi
wallet_requestAccounts
wallet_requestChainId
wallet_requestChainId
wallet_strk20PrepareInvoke
```

The verification driver rejected any attempt to issue
`wallet_strk20InvokeTransaction`, `wallet_addInvokeTransaction`,
`wallet_addDeclareTransaction`, or `wallet_signTypedData`. None was observed.
No submitted transaction hash was returned.

> **NO TRANSACTION WAS SUBMITTED.**

## Fail-closed coverage

The tests reject stale data, a head behind the source, hash disagreement, broken
parent links, incomplete pages, missing selectors, unknown selectors, malformed
ABI/event/snapshot data, unsupported wallets/tokens/actions, wrong wallet
networks, malformed amounts, and invalid flexibility bounds. Operational
failures return `NO_CONFIDENT_RECOMMENDATION` without a band or `ALLOW`.

`npm run check` passed all 37 declared tests: 7 engine tests and 30 mainnet
spike tests including nested fail-closed cases.

## Not executed

- No transaction was signed or submitted.
- `strk20InvokeTransaction` was not called.
- No frontend, database, production indexer, cache, contract, paymaster, or
  session key was created.
- No private STRK20 state was requested.
- No wallet history or private telemetry was collected.

## Milestone 1A verification history

**Attempted:** 2026-08-16
**Result:** `BROWSER_CONTEXT_UNAVAILABLE`

The execution environment contains Chromium/Playwright binaries but no running
browser Wallet Standard session, installed Starknet wallet extension, or
injected wallet registry. The Node adapter therefore returned the explicit
`BROWSER_CONTEXT_UNAVAILABLE` state. The virtual-wallet package and test wallet
are not being used as evidence of real-wallet support.

A second `npm run spike:mainnet` attempt on this date rebuilt successfully but
could not reach the configured RPC: the restricted execution environment
returned `fetch failed` before any RPC response. It emitted `FAILED_CLOSED` and
did not produce a new snapshot or preflight result. The live values reported in
this document remain the last successful public-data run from 2026-08-14; no
newer live result is inferred from the failed retry.

That blocker was cleared later on 2026-08-16 by attaching to the user-approved
local Chromium profile containing Ready X. The successful evidence is recorded
above. Milestone 1 is now `COMPLETE`.

> **NO TRANSACTION WAS SUBMITTED.**
