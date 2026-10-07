import { randomUUID, createHash } from "node:crypto";
import {
  addSignersToInstruction,
  createClient,
  generateKeyPairSigner,
  getAddressDecoder,
  getAddressEncoder,
  lamports,
  type Address,
} from "@solana/kit";
import { litesvm } from "@solana/kit-plugin-litesvm";
import { signer } from "@solana/kit-plugin-signer";
import {
  tokenProgram,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
} from "@solana-program/token";
import {
  buildCreateCoreCollectionInstruction,
  CORE_PROGRAM_ADDRESS,
} from "../../src/core.js";
import * as registry from "../../src/generated/registry/index.js";

// Simulation settings, never a production price, fee commitment or stablecoin.
export const TEST_PAYMENT = Object.freeze({
  label: "Katha local test token (no monetary value)",
  decimals: 6,
  buyerBalance: 1_000_000_000n,
  examplePrice: 100_000_000n,
  commissionBps: 250,
  secondaryRoyaltyBps: 500,
  inspectionValiditySeconds: 30n * 24n * 60n * 60n,
});
const sha256 = (value: string) =>
  new Uint8Array(createHash("sha256").update(value).digest());

/** Fresh isolated LiteSVM, genuine token instructions and Registry-created Core assets. */
export async function createMarketplaceFixture() {
  const coreBinary = process.env.KATHA_TEST_CORE_SO;
  const registryBinary = process.env.KATHA_TEST_REGISTRY_SO;
  if (!coreBinary || !registryBinary) throw new Error("Run pnpm program:test");
  const roles = {
    bootstrap: await generateKeyPairSigner(),
    seller: await generateKeyPairSigner(),
    artist: await generateKeyPairSigner(),
    buyerA: await generateKeyPairSigner(),
    buyerB: await generateKeyPairSigner(),
    treasury: await generateKeyPairSigner(),
    verifier: await generateKeyPairSigner(),
    custody: await generateKeyPairSigner(),
    outsider: await generateKeyPairSigner(),
  };
  const client = createClient()
    .use(signer(roles.bootstrap))
    .use(litesvm({ transactionConfig: { version: 0 } }))
    .use(tokenProgram());
  client.svm.addProgramFromFile(CORE_PROGRAM_ADDRESS, coreBinary);
  client.svm.addProgramFromFile(
    registry.KATHA_REGISTRY_PROGRAM_ADDRESS,
    registryBinary,
  );
  for (const actor of Object.values(roles))
    client.svm.airdrop(actor.address, lamports(5_000_000_000n));
  const clock = client.svm.getClock();
  clock.unixTimestamp = 1_800_000_000n;
  client.svm.setClock(clock);

  // Only bootstrap authority/SOL/clock are installed directly. Artwork and payment
  // state below is created by real program execution, never encoded account mocks.
  const program = client.svm.getAccount(registry.KATHA_REGISTRY_PROGRAM_ADDRESS);
  if (!program.exists || program.data[0] !== 2)
    throw new Error("Missing upgradeable Registry");
  const programDataAddress = getAddressDecoder().decode(program.data.subarray(4, 36));
  const programData = client.svm.getAccount(programDataAddress);
  if (!programData.exists || programData.data[12] !== 0)
    throw new Error("Unexpected Registry ProgramData");
  const data = new Uint8Array(programData.data.length + 32);
  data.set(programData.data.subarray(0, 12));
  data[12] = 1;
  data.set(getAddressEncoder().encode(roles.bootstrap.address), 13);
  data.set(programData.data.subarray(13), 45);
  client.svm.setAccount({
    ...programData,
    data,
    space: BigInt(data.length),
    lamports: lamports(programData.lamports + 1_000_000n),
  });

  const collection = await generateKeyPairSigner();
  const [collectionAuthority] = await registry.findCollectionAuthorityPda();
  await client.sendTransaction([
    addSignersToInstruction(
      [collection, roles.bootstrap],
      buildCreateCoreCollectionInstruction({
        collectionAddress: collection.address,
        payerAddress: roles.bootstrap.address,
        updateAuthorityAddress: collectionAuthority,
        name: "Katha synthetic settlement fixtures",
        uri: "https://example.com/katha-local-collection.json",
      }),
    ),
  ]);
  await client.sendTransaction([
    await registry.getInitializePlatformInstructionAsync({
      bootstrapAuthority: roles.bootstrap,
      programData: programDataAddress,
      collection: collection.address,
      registrationAuthority: roles.seller.address,
      verifierAuthority: roles.verifier.address,
      custodyAuthority: roles.custody.address,
      treasury: roles.treasury.address,
    }),
  ]);

  const mint = await generateKeyPairSigner(),
    wrongMint = await generateKeyPairSigner(),
    wrongDecimalsMint = await generateKeyPairSigner();
  for (const [newMint, decimals] of [
    [mint, TEST_PAYMENT.decimals],
    [wrongMint, TEST_PAYMENT.decimals],
    [wrongDecimalsMint, 9],
  ] as const) {
    await client.token.instructions
      .createMint({
        newMint,
        decimals,
        mintAuthority: roles.bootstrap.address,
        freezeAuthority: null,
      })
      .sendTransaction();
  }
  const ata = async (owner: Address, paymentMint = mint.address) =>
    (
      await findAssociatedTokenPda({
        owner,
        mint: paymentMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      })
    )[0];
  const tokenAccounts = {
    seller: await ata(roles.seller.address),
    artist: await ata(roles.artist.address),
    buyerA: await ata(roles.buyerA.address),
    buyerB: await ata(roles.buyerB.address),
    treasury: await ata(roles.treasury.address),
    wrongMintBuyer: await ata(roles.buyerA.address, wrongMint.address),
  };
  for (const actor of [
    roles.seller,
    roles.artist,
    roles.buyerA,
    roles.buyerB,
    roles.treasury,
  ]) {
    await client.token.instructions
      .mintToATA({
        owner: actor.address,
        mint: mint.address,
        mintAuthority: roles.bootstrap,
        amount:
          actor === roles.buyerA || actor === roles.buyerB
            ? TEST_PAYMENT.buyerBalance
            : 0n,
        decimals: TEST_PAYMENT.decimals,
      })
      .sendTransaction();
  }
  await client.token.instructions
    .mintToATA({
      owner: roles.buyerA.address,
      mint: wrongMint.address,
      mintAuthority: roles.bootstrap,
      amount: TEST_PAYMENT.buyerBalance,
      decimals: TEST_PAYMENT.decimals,
    })
    .sendTransaction();

  const artistId = randomUUID();
  async function createArtwork(serial: number) {
    const kathaId = `KATHA-PAUBHA-${String(serial).padStart(6, "0")}`;
    const [artwork] = await registry.findArtworkPda({ kathaId });
    const evidenceHash = sha256(`synthetic authorship ${kathaId}`);
    const metadataHash = sha256(`synthetic metadata ${kathaId}`);
    const reportHash = sha256(`synthetic inspection ${kathaId}`);
    const reportId = new Uint8Array(
      Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
    );
    const inspectorId = new Uint8Array(
      Buffer.from(randomUUID().replaceAll("-", ""), "hex"),
    );
    await client.sendTransaction([
      await registry.getRegisterArtworkInstructionAsync({
        registrationAuthority: roles.seller,
        kathaId,
        artistId,
        creatorWallet: roles.artist.address,
        category: registry.ArtworkCategory.Paubha,
        creationYear: 2026,
        authorshipEvidenceHash: evidenceHash,
      }),
    ]);
    await client.sendTransaction([
      await registry.getVerifyArtworkInstructionAsync({
        artwork,
        verifierAuthority: roles.verifier,
        expectedAuthorshipEvidenceHash: evidenceHash,
      }),
    ]);
    await client.sendTransaction([
      await registry.getInitializeMetadataInstructionAsync({
        artwork,
        registrationAuthority: roles.seller,
        documentHash: metadataHash,
        uri: `https://example.com/${kathaId}.json`,
      }),
    ]);
    await client.sendTransaction([
      await registry.getInitializeConditionInstructionAsync({
        artwork,
        verifierAuthority: roles.verifier,
        reportId,
        reportHash,
        grade: registry.ConditionGrade.Excellent,
        reason: registry.ConditionReason.InitialVerification,
        inspectorId,
        inspectedAt: clock.unixTimestamp - 60n,
      }),
    ]);
    await client.sendTransaction([
      await registry.getInitializeCustodyInstructionAsync({
        artwork,
        custodyAuthority: roles.custody,
        action: registry.CustodyAction.AttestKathaCustody,
        collector: null,
      }),
    ]);
    const [metadataRevision] = await registry.findReviseMintedMetadataRevisionPda({
      artwork,
      nextVersion: 1,
    });
    const [initialCondition] = await registry.findReportPda({ reportId });
    await client.sendTransaction([
      await registry.getMintArtworkInstructionAsync({
        artwork,
        metadataRevision,
        initialCondition,
        collection: collection.address,
        registrationAuthority: roles.seller,
      }),
    ]);
    const [asset] = await registry.findAssetPda({ artwork });
    return {
      kathaId,
      artwork,
      asset,
      evidenceHash,
      metadataHash,
      reportHash,
      reportId,
      metadataRevision,
      initialCondition,
    };
  }
  const artwork = await createArtwork(1),
    secondArtwork = await createArtwork(2);
  return {
    cluster: "LOCALNET" as const,
    transactionVersion: 0 as const,
    client,
    roles,
    artistId,
    collection: collection.address,
    collectionAuthority,
    mint: mint.address,
    wrongMint: wrongMint.address,
    wrongDecimalsMint: wrongDecimalsMint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    tokenAccounts,
    artwork,
    secondArtwork,
    clock: clock.unixTimestamp,
    settings: TEST_PAYMENT,
  };
}
