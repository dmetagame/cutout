import assert from "node:assert/strict";
import test from "node:test";

import * as guard from "../dist/guard-package.js";

const EXPECTED_EXPORTS = [
  "CUTOUT_GUARD_API_VERSION",
  "CUTOUT_MAINNET",
  "CUTOUT_VERSIONS",
  "RECEIPT_SCHEMA_VERSION",
  "WorkflowError",
  "assertGuardedDepositPlan",
  "assertSubmissionAuthorization",
  "authorizeSubmission",
  "createGuardedDepositPlan",
  "decisionAllowsWalletCall",
  "formatTokenAmount",
  "makeFinalExactIntent",
  "parseBaseUnitAmount",
  "parsePreflightApiResponse",
  "parseTokenAmount",
  "requestPreflight",
  "validateSimulationEvidence",
  "validateSingleDepositAction",
  "verifyDepositReceipt",
].sort();

test("the package exposes only the reviewed guard integration surface", () => {
  assert.deepEqual(Object.keys(guard).sort(), EXPECTED_EXPORTS);
  assert.equal(guard.CUTOUT_VERSIONS.model, "CUTOUT-v1.3");
  assert.equal(guard.CUTOUT_VERSIONS.guardPolicy, "GUARD_POLICY-v1");
  assert.equal(guard.CUTOUT_VERSIONS.freshnessPolicy, "FRESHNESS_POLICY-v1");
  assert.equal(guard.CUTOUT_MAINNET.chainId, "0x534e5f4d41494e");
});

test("the package action gate accepts one deposit and rejects arbitrary actions", () => {
  const token = guard.CUTOUT_MAINNET.tokens.find((item) => item.symbol === "STRK");
  assert.ok(token);
  assert.deepEqual(guard.validateSingleDepositAction([{
    type: "deposit",
    token: token.address,
    amount: "0x1",
  }]), {
    type: "deposit",
    token: token.address,
    amount: "0x1",
  });
  assert.throws(
    () => guard.validateSingleDepositAction([{
      type: "invoke",
      contractAddress: guard.CUTOUT_MAINNET.poolAddress,
      calldata: ["0x1"],
    }]),
    (error) => error instanceof guard.WorkflowError && error.code === "UNSUPPORTED_ACTION",
  );
});

test("the package has no wallet, indexer, database, RPC, or engine execution export", () => {
  for (const forbidden of [
    "CanonicalStore",
    "IncrementalIndexer",
    "WalletAccountV6",
    "connectWallet",
    "evaluatePreflight",
    "mainnetConfig",
    "strk20InvokeTransaction",
    "submitAuthorizedDeposit",
  ]) {
    assert.equal(forbidden in guard, false, `${forbidden} must not be public`);
  }
});
