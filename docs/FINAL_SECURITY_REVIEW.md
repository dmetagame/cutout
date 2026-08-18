# Final adversarial security review

**Release:** `v0.1.2`
**Model:** `CUTOUT-v1.3`
**Policies:** `GUARD_POLICY-v1`, `FRESHNESS_POLICY-v1`

`PASS` means the implemented release enforces the documented boundary. It does
not mean the residual risk is eliminated or outside systems are trusted.

| Scenario | Result | Implemented control | Residual risk |
|---|---|---|---|
| Stale RPC | PASS | Maximum source age and index lag are both 120 seconds; stale snapshots are unavailable. | Clock integrity and honest timestamps remain operational assumptions. |
| Malicious RPC | PASS | Expected chain, pool class, block links, and a second provider are checked. | Two colluding providers or a shared upstream can present the same false view. |
| RPC disagreement | PASS | Common-block disagreement returns `INCONSISTENT_BLOCK_DATA`; no snapshot is published. | Availability is lost until providers converge or operators intervene. |
| Indexer corruption | PASS | SQLite integrity, frozen identity, cursor, snapshot hash, completeness, and schema checks fail closed. | Host-level compromise can destroy availability or replace both code and data. |
| Duplicate events | PASS | Transaction hash plus deterministic event ordinal is the event identity. | A malformed provider response causes unavailability rather than reinterpretation. |
| Event ordering | PASS | RPC pages are canonicalized and sorted before normalization and hashing. | The reviewed ABI remains a trusted schema input. |
| Reorg | PASS | Hash divergence rolls back to the latest retained common ancestor and replays. | A reorg deeper than retained history triggers full replay and temporary unavailability. |
| Pool schema change | PASS | Unexpected class hash returns `POOL_SCHEMA_MISMATCH`. | Supporting a legitimate upgrade requires a new reviewed release. |
| Malformed token or amount | PASS | Canonical address, supported-token, positive u128, and exact base-unit checks run before wallet access. | Integrators must preserve the package guard boundary. |
| Unsupported or mixed actions | PASS | Exactly one `deposit` is accepted; transfer, withdraw, invoke, mixed arrays, and calldata fail closed. | A forked client that removes validation is outside this release. |
| Recommendation outside bounds | PASS | Recommendation token/action and `min <= target <= max` are rebound during final validation. | The user may still choose the original amount despite a warning. |
| Manipulated recommendation | PASS | Final exact intent is independently preflighted and snapshot/model/policy versions are rebound. | A fully compromised frontend can mislead the user, though the wallet still shows the exact action. |
| Backend compromise | PASS | Server modules contain no wallet account, key, signing, or submission capability. | An attacker can deny service or return unavailable/misleading UI data if frontend trust is also lost. |
| Frontend compromise | PASS | Wallet confirmation remains mandatory and the package validates the exact action before wallet calls. | A malicious frontend can misdisplay evidence or request an unwanted supported deposit; users must inspect the wallet prompt. |
| Wallet compromise | PASS | Cutout never receives wallet secrets and does not claim to secure a compromised wallet. | A compromised wallet can sign or lie about the action; this is outside Cutout's authority. |
| Receipt spoofing | PASS | Receipt lookup uses an independent public RPC and requires successful inclusion plus the reviewed Deposit event. | Colluding RPC infrastructure can affect public observations; cross-provider verification can be expanded later. |
| Transaction/account mismatch | PASS | Receipt verification binds transaction, account/depositor, pool, token, amount, block, and selector. | Protocol event semantics remain dependent on the reviewed ABI. |
| Token or pool mismatch | PASS | Frozen mainnet config is checked in intent, plan, wallet identity, and receipt. | A future pool or token requires explicit configuration and review. |
| Arbitrary calldata | PASS | There is no supported arbitrary invoke or calldata input path. | Browser extensions or unrelated dApps remain outside Cutout. |
| Private data leakage | PASS | No private key, seed, viewing-key payload, note, proof, or shielded balance enters the model or store. | Wallet, browser, exchange, and RPC telemetry can reveal information outside the public-observer model. |
| Telemetry leakage | PASS | Application metrics are aggregate and omit raw account, amount, and intent bodies. | Infrastructure access logs must also be configured without unnecessary request-body capture. |
| Server signing capability | PASS | Static regression tests reject wallet submission imports or methods in server/indexer routes. | Host compromise cannot sign without separately compromising the user's wallet. |

## Final conclusion

No release-blocking security defect was found. The strongest residual risks are
compromised user software, colluding public-data providers, host availability,
and telemetry outside the published passive-public-observer threat model.
These are documented limitations, not converted into favorable Cutout results.
