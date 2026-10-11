import assert from "node:assert/strict";
import { test } from "node:test";
import { createDevnetDeploymentPlan } from "./devnet-plan.mjs";
const operator = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const config = {
  cluster: "devnet",
  operator,
  collection: "Vote111111111111111111111111111111111111111",
  collectionUri: "https://example.org/collection.json",
  registrationAuthority: operator,
  verifierAuthority: operator,
  custodyAuthority: operator,
  treasury: operator,
  paymentMint: "So11111111111111111111111111111111111111112",
};
test("deployment review is deterministic, public-only and pinned to Devnet", async () => {
  const plan = await createDevnetDeploymentPlan(config);
  assert.deepEqual(plan, await createDevnetDeploymentPlan(config));
  assert.equal(plan.mode, "review-only");
  assert.equal(plan.cluster, "devnet");
  assert.equal(plan.programs.registry, "5829CUnLsucsi3Tj7573LYV5gNQo35ztGhdY4yhNoAkC");
  assert.equal(
    plan.programs.marketplace,
    "B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq",
  );
  assert.equal(plan.addresses.collectionAuthority.length >= 32, true);
  assert.equal(plan.defaults.inspectionValiditySeconds, "2592000");
});
test("deployment review rejects wrong network, default authority and secret/unknown fields", async () => {
  for (const input of [
    { ...config, cluster: "mainnet" },
    { ...config, operator: "11111111111111111111111111111111" },
    { ...config, privateKey: "never accepted" },
    { ...config, collectionUri: "https://user:password@example.org/file" },
    { ...config, collectionUri: "http://example.org/file" },
    { ...config, paymentMint: "not-a-public-key" },
  ]) {
    await assert.rejects(createDevnetDeploymentPlan(input));
  }
});
