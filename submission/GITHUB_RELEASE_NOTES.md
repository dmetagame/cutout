# CUTOUT v0.1.2

Cutout v0.1.2 is a presentation-only patch for the signing-decision and public
receipt experience. The existing v0.1.1 and v0.1.0 tags and releases remain
unchanged.

## Improved

- Added a clear Propose -> Verify -> Review -> Sign workflow rail with explicit
  loading, unavailable, recommendation, simulation, confirmation, and receipt
  states.
- Reworked deterministic evidence into a readable primary summary with
  progressive disclosure for signals, freshness, hashes, and policy versions.
- Made the wallet boundary explicit: simulation is labeled as non-submitting,
  the exact single action is reviewable, and Cutout states that it cannot sign.
- Improved recommendation comparison, verified receipt presentation, receipt ID
  copying, and Starkscan navigation.
- Added responsive layouts for narrow screens, visible keyboard focus, and
  reduced-motion behavior.
- Corrected visual flow-step mapping for connected and wallet-error states.

No CUTOUT-v1.3 scoring rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule,
API contract, indexer behavior, receipt-verification rule, supported action, or
wallet execution path changed.

## Verification

- 135 root tests
- 18 Milestone 4 focused tests
- 5 Milestone 5 focused tests
- 3 package API tests
- 7 browser E2E tests
- Root/web typechecks and Next.js production build
- Packed consumer verification
- Desktop and 390px fixture flow checks
- Receipt navigation and mobile overflow checks
- Reduced-motion and visible-focus checks
- `git diff --check`
- `npm audit --audit-level=high`: 0 vulnerabilities

The latest live wallet evidence remains the v0.1.1 Ready X `5.33.8` simulation
that reached `READY_FOR_CONFIRMATION` using Wallet API `0.10.3`. No confirmation,
invoke/broadcast method, transaction hash, or transaction submission occurred.
The historical Milestone 3 transaction remains separate execution evidence:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.

Cutout remains a signing guard, not a privacy guarantee. The backend cannot
sign or broadcast, and users retain final wallet authority.
