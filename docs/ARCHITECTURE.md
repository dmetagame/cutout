# Cutout release architecture

Cutout has three deliberately separate planes: public observation,
deterministic analysis, and user-controlled execution. Only the wallet can
sign or submit.

The diagram below shows the deposit execution path in the deployed `v0.2.0`
architecture. `CUTOUT-v1.3` remains the frozen replay path and the release adds
named `CUTOUT-v1.4` observation and analysis without adding execution authority.

```mermaid
flowchart TB
  subgraph PublicObservation[Public observation]
    SN[Public Starknet]
    RPC[Primary and secondary RPC]
    EVENTS["STRK20 Deposit, Withdrawal, and ViewingKeySet events<br/>plus block headers"]
    INDEXER[Supervised incremental indexer]
    STORE[(Canonical SQLite read model)]
    SNAPSHOT["Complete canonical PublicSnapshot<br/>and deterministic snapshot hash"]
    SN --> RPC --> EVENTS --> INDEXER --> STORE --> SNAPSHOT
  end

  subgraph DeterministicAnalysis[Deterministic analysis]
    INTENT["Typed shield or withdrawal intent"]
    API[POST /api/preflight]
    ENGINE[CUTOUT-v1.4]
    POLICY[GUARD_POLICY-v1]
    EVIDENCE["Band, signals, cohort evidence,<br/>recommendation or refusal"]
    INTENT --> API
    SNAPSHOT --> API --> ENGINE --> POLICY --> EVIDENCE
  end

  subgraph UserControlledSigning[User-controlled signing]
    BROWSER["Cutout browser client<br/>final revalidation"]
    PREPARE["WalletAccountV6<br/>strk20PrepareInvoke simulate=true"]
    REVIEW["Exact wallet review<br/>and explicit user confirmation"]
    INVOKE[Wallet-owned strk20InvokeTransaction]
    POOL[Reviewed STRK20 pool]
    RECEIPT[Independent public receipt verification]
    EVIDENCE --> BROWSER --> PREPARE --> REVIEW --> INVOKE --> POOL
    RPC -. independent public receipt .-> RECEIPT
    RECEIPT --> BROWSER
  end

  BROWSER -. final exact intent .-> INTENT
```

## Authority boundaries

| Boundary | Authority | Prohibited capability |
|---|---|---|
| Indexer | Normalize reviewed public pool events and canonical block provenance. | Wallet access, signing, private notes, viewing-key payloads, proofs, or shielded balances. |
| Preflight API | Load one complete snapshot and return deterministic CUTOUT-v1.4 evidence. | Signing, broadcasting, changing the user's token/action/amount, or serving stale evidence as current. |
| Browser | Own user intent, recommendation selection, final review, and wallet-call state. | Bypassing final preflight or broadening user-approved flexibility. |
| Wallet | Hold keys, simulate, display the exact action, request approval, sign, and submit. | Delegating signing authority to the Cutout backend. |
| Receipt verifier | Independently read public inclusion and bind account, pool, token, amount, and event. | Treating a transaction hash alone as proof of the expected deposit. |

## Data flow guarantees

1. The indexer atomically advances its cursor and never publishes a partial
   range as the current snapshot.
2. Reorg, class-hash change, RPC disagreement, missing headers, stale source
   data, and excess index lag withdraw confident evidence.
3. The browser consumes the API result; it does not calculate an independent
   privacy or risk claim.
4. A selected recommendation becomes a new exact intent and is preflighted
   again before simulation.
5. No validation means no wallet call. No verified receipt means no success
   claim.

## Scope

The release supports one reviewed Starknet mainnet STRK20 pool, a typed
`deposit` wallet path, and typed `withdrawal` analysis. It does not add a Cairo contract because the public
evidence calculation and recommendation do not require onchain authority.
Cutout does not claim anonymity, untraceability, guaranteed unlinkability, or
protection against private wallet, exchange, browser, or RPC telemetry.

## CUTOUT-v1.4 release extension

The successor keeps the same three-plane boundary:

```text
Public Deposit + Withdrawal + ViewingKeySet events
    -> model-versioned canonical snapshot
    -> CUTOUT-v1.4 deposit or withdrawal analysis
    -> public cover/evidence surface
    -> deposit path only: final exact preflight -> wallet simulation -> user wallet
```

For a typed withdrawal, v1.4 evaluates public S2 counterpart and S3 proximity
evidence, plus the shared cohort signals. The browser renders the result and
stops at an analysis-only boundary; it does not construct, simulate, confirm,
or submit a withdrawal action. S7 round-amount detection and `WAIT` are
deterministic advisory outputs, never automatic scheduling or execution.

The release also exposes a wallet-free cover ledger derived from the same
complete snapshot as preflight. It contains aggregate cohorts and provenance,
not raw actors or encrypted viewing-key payloads. Deposit execution remains the
only wallet action.
