# CUTOUT v0.1.3

Cutout v0.1.3 is the final pre-submission patch for receipt evidence
presentation and release/demo documentation. The existing v0.1.2, v0.1.1, and
v0.1.0 tags and releases remain unchanged.

## Improved

- Validate the exact structure of a session-stored receipt artifact before it
  can render as verified evidence.
- Recompute the existing deterministic receipt ID and reject artifacts whose
  displayed fields no longer match that binding.
- Add E2E mutation rejection plus 390px overflow, Starkscan navigation,
  keyboard-focus, and reduced-motion coverage for the receipt view.
- Refresh production chronology, the 3-5 minute demo, pitch, judge FAQ, and
  submission package for the live Cutout deployment.

The v0.1.2 Propose -> Verify -> Review -> Sign hierarchy, evidence disclosure,
recommendation comparison, explicit wallet boundary, responsive layouts, and
accessibility polish remain the presentation baseline.

No CUTOUT-v1.3 scoring rule, GUARD_POLICY-v1 rule, FRESHNESS_POLICY-v1 rule,
API contract, indexer behavior, independent receipt-verification rule,
supported action, or wallet execution path changed.

## Verification

- 135 root tests
- 18 Milestone 4 focused tests
- 5 Milestone 5 focused tests
- 3 package API tests
- 9 browser E2E tests
- Root/web typechecks and Next.js production build
- Packed consumer verification
- Desktop and 390px fixture flow checks
- Receipt navigation and mobile overflow checks
- Reduced-motion and visible-focus checks
- `git diff --check`
- `npm audit --audit-level=high`: 0 vulnerabilities

The latest real-wallet evidence remains the v0.1.1 Ready X `5.33.8` simulation
that reached `READY_FOR_CONFIRMATION` using Wallet API `0.10.3`. The current
production browser smoke used a simulation-only Wallet Standard harness and
also reached `READY_FOR_CONFIRMATION` with `connectCalls=1`, `prepareCalls=1`,
and `invokeCalls=0`. Neither run confirmed, broadcast, produced a transaction
hash, or submitted a transaction.
The historical Milestone 3 transaction remains separate execution evidence:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.

Cutout remains a signing guard, not a privacy guarantee. The backend cannot
sign or broadcast, and users retain final wallet authority.

Production deployment: `https://cutout.rouma.online` (`v0.1.3`)
