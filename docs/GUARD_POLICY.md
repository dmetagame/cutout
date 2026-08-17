# GUARD_POLICY-v1

**Version 1. Frozen 2026-08-14 for the mainnet shield-preflight spike.**

This policy maps a successful CUTOUT-v1.3 evidence result to the signing-path
guard's operational decision:

| CUTOUT-v1.3 band | Guard decision |
|---|---|
| `HIGH` | `DENY` |
| `MEDIUM` | `WARN` |
| `LOW` | `ALLOW` |

These are guard decisions, not new scoring rules. CUTOUT-v1.3 alone determines
the signals and band under `docs/THREAT_MODEL.md`; this policy does not add,
remove, weight, or reinterpret a signal.

The mapping applies only after the input intent, pool ABI, source completeness,
snapshot integrity, and FRESHNESS_POLICY-v1 checks all succeed. Any operational
failure returns `NO_CONFIDENT_RECOMMENDATION`, with no band and no `ALLOW`.

`ALLOW` means only that CUTOUT-v1.3 returned `LOW` from the verified public
snapshot. It is not a claim of anonymity, untraceability, unlinkability, or a
probability of deanonymization.
