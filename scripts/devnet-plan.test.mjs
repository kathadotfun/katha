import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
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
  assert.equal(plan.programs.registry, "Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr");
  assert.equal(
    plan.programs.marketplace,
    "B7q1HFwusCjndtLaTd75wUCSTPtrYw88ABAonLw4b8Lq",
  );
  assert.equal(plan.addresses.collectionAuthority.length >= 32, true);
  assert.equal(plan.defaults.inspectionValiditySeconds, "2592000");
});

test("published Devnet configuration matches generated identities and bootstrap bindings", async () => {
  const network = JSON.parse(
    await readFile(new URL("../config/devnet/network.json", import.meta.url), "utf8"),
  );
  const plan = await createDevnetDeploymentPlan(network.bootstrapInputs);
  assert.equal(network.cluster, "devnet");
  assert.equal(network.genesisHash, "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  assert.equal(network.verification.realArtworkTwoWalletNfcDemoVerified, false);
  assert.equal(network.programs.registry.programId, plan.programs.registry);
  assert.equal(network.programs.marketplace.programId, plan.programs.marketplace);
  const registry = network.programs.registry.configuration;
  const marketplace = network.programs.marketplace.configuration;
  assert.equal(registry.address, plan.addresses.registryConfig);
  assert.equal(registry.collectionAuthority, plan.addresses.collectionAuthority);
  assert.equal(marketplace.address, plan.addresses.marketplaceConfig);
  for (const field of [
    "registrationAuthority",
    "verifierAuthority",
    "custodyAuthority",
    "treasury",
    "collection",
  ])
    assert.equal(registry[field], network.bootstrapInputs[field]);
  assert.equal(registry.authority, network.bootstrapInputs.operator);
  assert.equal(marketplace.authority, network.bootstrapInputs.operator);
  assert.equal(marketplace.registryProgram, plan.programs.registry);
  assert.equal(marketplace.registryConfig, registry.address);
  assert.equal(marketplace.collection, registry.collection);
  assert.equal(marketplace.treasury, registry.treasury);
  assert.equal(marketplace.paymentMint, network.paymentMint.address);
  assert.equal(marketplace.tokenProgram, network.paymentMint.tokenProgram);
  assert.equal(marketplace.paymentDecimals, network.paymentMint.decimals);
  assert.equal(marketplace.commissionBps, plan.defaults.commissionBps);
  assert.equal(marketplace.secondaryRoyaltyBps, plan.defaults.secondaryRoyaltyBps);
  assert.equal(
    marketplace.inspectionValiditySeconds,
    plan.defaults.inspectionValiditySeconds,
  );
  assert.equal(network.collection.address, registry.collection);
  assert.equal(network.collection.updateAuthority, registry.collectionAuthority);
  assert.equal(network.collection.uri, network.collectionMetadata.uri);
  const collectionBytes = await readFile(
    new URL("../config/devnet/collection.json", import.meta.url),
  );
  assert.equal(
    createHash("sha256").update(collectionBytes).digest("hex"),
    network.collectionMetadata.sha256,
  );
});

test("plan help accepts the package manager's optional argument separator", () => {
  const script = fileURLToPath(new URL("./devnet-plan.mjs", import.meta.url));
  const direct = execFileSync(process.execPath, [script, "--help"], {
    encoding: "utf8",
  });
  const separated = execFileSync(process.execPath, [script, "--", "--help"], {
    encoding: "utf8",
  });
  assert.equal(separated, direct);
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
