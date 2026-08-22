# CUTOUT v0.2.0

Cutout v0.2.0 is the CUTOUT-v1.4 depth release. The existing v0.1.4, v0.1.3,
v0.1.2, v0.1.1, and v0.1.0 tags and releases remain unchanged.

## Improved

- Add typed public `Withdrawal` ingestion and analysis without adding a
  withdrawal execution path.
- Add withdrawal-only S2/S3 evidence, S7 round-amount detection, deterministic
  `WAIT` advice, a wallet-free public cover ledger, and a live amount ladder.
- Add the evidence-only `@cutout/guard/react` integration surface.
- Add Lenis `1.3.26` smooth scrolling with native-feeling anchors and touch
  behavior.
- Add a reusable GSAP `3.15.0` / `@gsap/react` `2.1.2` motion system for
  entrances, workflow-state transitions, evidence reveals, and receipt reveals.
- Clarify the Propose -> Verify -> Review -> Simulate -> User Wallet progression
  and the distinction between connection, simulation, confirmation, and
  submission.
- Improve evidence hierarchy, recommendation comparison, final simulation and
  `READY_FOR_CONFIRMATION` states, and verified receipt presentation.
- Improve responsive/mobile layout, keyboard focus, accessibility semantics,
  and reduced-motion behavior.

No signing authority, autonomous execution, or deposit transaction semantics
were added. `CUTOUT-v1.3`, `GUARD_POLICY-v1`, `FRESHNESS_POLICY-v1`, receipt
verification, and the wallet execution boundary remain unchanged. The named
`CUTOUT-v1.4` successor intentionally extends the public observation, database,
snapshot, and preflight surfaces for withdrawal analysis and cover evidence.
That analysis stops before wallet simulation or submission.

## Verification boundary

The release uses the existing non-submitting browser fixture. It must stop at
`READY_FOR_CONFIRMATION` with `connectCalls=1`, `prepareCalls=1`, and
`invokeCalls=0`; no transaction hash, confirmation, broadcast, or submission is
part of this release.

The historical Milestone 3 transaction remains separate execution evidence:
`0x50f81ee1b9e90576d51dde9dd73bdd89f481b677ceb9b6d244027cbe0499c9e`.

Cutout remains a signing guard, not a privacy guarantee. The backend cannot
sign or broadcast, and users retain final wallet authority.

Production target: `https://cutout.rouma.online` (`v0.2.0` after the separate
deployment smoke passes)
