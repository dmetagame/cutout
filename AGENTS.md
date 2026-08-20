# Cutout agent contract

Read and follow [`docs/agent/CUTOUT_CODEX_MASTER_PROMPT.md`](docs/agent/CUTOUT_CODEX_MASTER_PROMPT.md) before changing this repository.

The repository is an existing Next.js and TypeScript system. Do not scaffold a replacement application or change its architecture without an explicit, reviewed need.

## Hard boundaries

- Cutout is a public-data STRK20 signing preflight. Ready X remains the only signer.
- Never add backend keys, private-note access, autonomous signing, automatic confirmation, or transaction broadcasting.
- Stale, incomplete, inconsistent, corrupt, reorg-uncertain, or schema-uncertain evidence must fail closed.
- Keep `CUTOUT-v1.3`, `GUARD_POLICY-v1`, and `FRESHNESS_POLICY-v1` available for exact replay. New actions, signals, or recommendation kinds require a named successor version.
- S6 remains a post-execution conservation-of-value holdout. It is not a preflight signal.
- Token amounts use integer/base-unit arithmetic only.
- Do not claim anonymity, untraceability, unlinkability, or a probability of deanonymization.
- Do not submit a mainnet transaction without explicit user authorization.

## Working discipline

- Preserve the observation, analysis, execution, and receipt-verification seams.
- Add tests at the public interface for every behavior change.
- Use `apply_patch` for manual edits and keep generated artifacts, databases, credentials, logs, browser profiles, screenshots, and package tarballs out of commits.
- Run the strongest relevant verification after changes, including `npm run ci:verify` before release work.
