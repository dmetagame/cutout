# Cutout pitches

## One sentence

Cutout is a wallet-native signing guard that uses deterministic public STRK20
evidence to help users avoid predictable deposit amounts before they sign.

## 100-150 words

STRK20 protects private state, but deposits remain public at the edge. An exact
amount can become an operational fingerprint when few prior users deposited the
same token and amount. Cutout checks that public evidence before the wallet
signs. Its supervised indexer builds a fresh canonical snapshot from reviewed
STRK20 events and block headers, then the frozen CUTOUT-v1.3 engine returns a
risk band, fired signals, cohort evidence, and an in-bounds recommendation when
the user explicitly permits flexibility. The final amount is preflighted again,
simulated through Ready X using WalletAccountV6, and shown for explicit wallet
confirmation. The backend cannot sign or broadcast. Cutout also independently
verifies the public receipt after submission. A real `0.01 STRK` mainnet deposit
proved the complete execution path. Cutout is a signing guard, not a privacy
guarantee, and it never accesses private notes or viewing keys.

## 300-500 words

STRK20 provides cryptographic protection for private state, but users still
cross a public boundary when they deposit into or withdraw from the pool. At
that boundary, exact amounts matter. A distinctive deposit can stand out even
when the protocol's cryptography works exactly as intended, and high aggregate
pool activity does not necessarily provide useful cover for one exact amount.

Cutout addresses that narrow problem at signing time. The user proposes one
typed STRK20 deposit and optionally defines the minimum and maximum amount they
are willing to use. A supervised Starknet indexer reads only public Deposit and
ViewingKeySet observations, validates canonical block provenance and the
reviewed pool class, and publishes a complete deterministic snapshot. The
frozen CUTOUT-v1.3 engine evaluates the proposed amount against that snapshot.
It returns a risk band, signal evidence, exact-amount cohort information, and a
recommendation only when a healthier candidate exists inside the user's stated
bounds. It never fabricates an improved amount.

The browser then makes the signing decision explicit. If the user chooses a
recommendation, Cutout creates a new exact intent and runs preflight again. The
guard binds the token, amount, account, pool, chain, snapshot, model, policy,
displayed value, and wallet identity before any wallet call. Ready X remains
the signing authority: WalletAccountV6 prepares and simulates the one supported
deposit, the wallet displays the action, and only explicit user confirmation
can submit it. The backend has no wallet account, private key, signing method,
or broadcast capability.

Cutout also verifies the resulting public receipt independently of the signing
wallet. A successful result requires the included transaction and reviewed
STRK20 Deposit event to match the expected account, pool, token, and amount. A
controlled `0.01 STRK` mainnet transaction proved this complete path, while the
final release smoke used fresh mainnet data without submitting anything.

The release includes deterministic replay tests, reorg recovery, RPC
cross-checking and failover, fail-closed freshness rules, an unprivileged
Docker deployment package, and `@cutout/guard@0.1.2` for integrators. Cutout
does not claim anonymity or untraceability. It reports public candidate-cohort
evidence under a published passive-public-observer threat model. That honesty
is part of the product: Cutout helps users make a better-informed signing
choice without pretending to control the wallet or guarantee privacy.

## Why this should win

- It solves a specific privacy usability failure at the exact moment of user
  authority: before signing.
- It is Starknet-native, using reviewed STRK20 events, Wallet API 0.10.3,
  WalletAccountV6, account abstraction, and independent Starknet receipts.
- Its evidence, recommendations, snapshots, and decision IDs are deterministic
  and reproducible rather than AI-generated or heuristic prose.
- It has real mainnet proof: a controlled deposit plus independent receipt
  verification, without requiring a new Cutout contract.
- It is integration-ready through a narrow package that cannot sign, index, or
  access private STRK20 state.
- It fails closed and states its limitations instead of making unsupported
  anonymity claims.
