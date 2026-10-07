import { expect, it } from "vitest";
import {
  fetchMint,
  fetchToken,
  getTransferCheckedInstruction,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getArtworkRecordDecoder,
  getArtworkVerificationDecoder,
  findVerificationPda,
  getCustodyHeadDecoder,
  findInitializeCustodyHeadPda,
} from "../src/generated/registry/index.js";
import { CORE_PROGRAM_ADDRESS, readCoreAsset } from "../src/core.js";
import { createMarketplaceFixture, TEST_PAYMENT } from "./fixtures/marketplace.js";

it("creates isolated six-decimal classic SPL balances and verified Registry-bound Core assets", async () => {
  const f = await createMarketplaceFixture();
  expect(f.cluster).toBe("LOCALNET");
  expect(f.transactionVersion).toBe(0);
  expect(new Set(Object.values(f.roles).map((actor) => actor.address)).size).toBe(9);
  expect(f.settings.label).toContain("no monetary value");
  expect(f.tokenProgram).toBe(TOKEN_PROGRAM_ADDRESS);
  const mint = await fetchMint(f.client.rpc, f.mint);
  expect(mint.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
  expect(mint.data).toMatchObject({
    decimals: 6,
    isInitialized: true,
    supply: 2n * TEST_PAYMENT.buyerBalance,
    mintAuthority: { __option: "Some", value: f.roles.bootstrap.address },
    freezeAuthority: { __option: "None" },
  });
  expect((await fetchMint(f.client.rpc, f.wrongDecimalsMint)).data.decimals).toBe(9);
  expect((await fetchMint(f.client.rpc, f.wrongMint)).data.decimals).toBe(6);
  expect(f.wrongMint).not.toBe(f.mint);
  for (const name of ["seller", "artist", "treasury", "buyerA", "buyerB"] as const) {
    const token = await fetchToken(f.client.rpc, f.tokenAccounts[name]);
    expect(token.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
    expect(token.data.mint).toBe(f.mint);
    expect(token.data.owner).toBe(f.roles[name].address);
    expect(token.data.amount).toBe(
      name === "buyerA" || name === "buyerB" ? TEST_PAYMENT.buyerBalance : 0n,
    );
  }
  for (const artwork of [f.artwork, f.secondArtwork]) {
    const record = f.client.svm.getAccount(artwork.artwork);
    if (!record.exists) throw new Error("Missing registered artwork");
    expect(getArtworkRecordDecoder().decode(record.data)).toMatchObject({
      artistId: f.artistId,
      coreAsset: { __option: "Some", value: artwork.asset },
      creatorWallet: { __option: "Some", value: f.roles.artist.address },
    });
    const verification = f.client.svm.getAccount(
      (await findVerificationPda({ artwork: artwork.artwork }))[0],
    );
    if (!verification.exists) throw new Error("Missing verification");
    expect(getArtworkVerificationDecoder().decode(verification.data).verifier).toBe(
      f.roles.verifier.address,
    );
    const custody = f.client.svm.getAccount(
      (await findInitializeCustodyHeadPda({ artwork: artwork.artwork }))[0],
    );
    if (!custody.exists) throw new Error("Missing custody");
    expect(getCustodyHeadDecoder().decode(custody.data).state).toBe(1);
    const asset = f.client.svm.getAccount(artwork.asset);
    if (!asset.exists) throw new Error("Missing Core asset");
    expect(asset.programAddress).toBe(CORE_PROGRAM_ADDRESS);
    expect(readCoreAsset(asset, artwork.asset, f.collection).owner).toBe(
      f.roles.seller.address,
    );
  }
  expect(f.artwork.asset).not.toBe(f.secondArtwork.asset);
}, 30_000);

it("executes classic token transfers and rolls back balances for unauthorized, wrong-mint, wrong-decimal and insufficient-fund failures", async () => {
  const f = await createMarketplaceFixture();
  const transfer = (
    amount: bigint,
    authority = f.roles.buyerA,
    destination = f.tokenAccounts.artist,
    decimals = 6,
  ) =>
    getTransferCheckedInstruction({
      source: f.tokenAccounts.buyerA,
      mint: f.mint,
      destination,
      authority,
      amount,
      decimals,
    });
  const amount = async (account: typeof f.mint) =>
    (await fetchToken(f.client.rpc, account)).data.amount;
  for (const instruction of [
    transfer(1n, f.roles.outsider),
    transfer(1n, f.roles.buyerA, f.tokenAccounts.wrongMintBuyer),
    transfer(1n, f.roles.buyerA, f.tokenAccounts.artist, 9),
    transfer(TEST_PAYMENT.buyerBalance + 1n),
  ]) {
    await expect(f.client.sendTransaction([instruction])).rejects.toThrow();
    expect(await amount(f.tokenAccounts.buyerA)).toBe(TEST_PAYMENT.buyerBalance);
    expect(await amount(f.tokenAccounts.artist)).toBe(0n);
  }
  // A valid first instruction must be undone if the next transfer fails.
  await expect(
    f.client.sendTransaction([
      transfer(TEST_PAYMENT.examplePrice),
      transfer(1n, f.roles.buyerA, f.tokenAccounts.wrongMintBuyer),
    ]),
  ).rejects.toThrow();
  expect(await amount(f.tokenAccounts.buyerA)).toBe(TEST_PAYMENT.buyerBalance);
  expect(await amount(f.tokenAccounts.artist)).toBe(0n);
  await f.client.sendTransaction([transfer(1n)]);
  expect(await amount(f.tokenAccounts.buyerA)).toBe(TEST_PAYMENT.buyerBalance - 1n);
  expect(await amount(f.tokenAccounts.artist)).toBe(1n);
  const core = f.client.svm.getAccount(f.artwork.asset);
  if (!core.exists) throw new Error("Missing artwork");
  expect(readCoreAsset(core, f.artwork.asset, f.collection).owner).toBe(
    f.roles.seller.address,
  );
}, 30_000);

it("enforces mint authority and preserves exact u64 token amounts beyond JavaScript's safe integer range", async () => {
  const f = await createMarketplaceFixture();
  const initialSupply = (await fetchMint(f.client.rpc, f.mint)).data.supply;
  await expect(
    f.client.sendTransaction([
      getMintToCheckedInstruction({
        mint: f.mint,
        token: f.tokenAccounts.buyerB,
        mintAuthority: f.roles.outsider,
        amount: 1n,
        decimals: 6,
      }),
    ]),
  ).rejects.toThrow();
  expect((await fetchMint(f.client.rpc, f.mint)).data.supply).toBe(initialSupply);
  const largeAmount = 9_007_199_254_740_993n;
  await f.client.token.instructions
    .mintToATA({
      owner: f.roles.buyerB.address,
      mint: f.mint,
      mintAuthority: f.roles.bootstrap,
      amount: largeAmount,
      decimals: 6,
    })
    .sendTransaction();
  expect((await fetchToken(f.client.rpc, f.tokenAccounts.buyerB)).data.amount).toBe(
    largeAmount + TEST_PAYMENT.buyerBalance,
  );
  expect((await fetchMint(f.client.rpc, f.mint)).data.supply).toBe(
    initialSupply + largeAmount,
  );
}, 30_000);
