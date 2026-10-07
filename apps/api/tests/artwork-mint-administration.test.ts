import { createApi } from "../src/app.js";
import { expect, it, vi } from "vitest";
import {
  getArtworkRecordDecoder,
  getArtworkRecordEncoder,
  getKathaConfigDecoder,
} from "@katha/solana/registry";
import type { ArtworkPublicationSnapshot, ArtworkPublicationStore } from "@katha/db";
import { mintFixture } from "./fixtures/minting.js";
import { createArtworkMintAdministration } from "../src/artwork-mint-administration.js";
async function fixture(minted = false) {
  const f = await mintFixture();
  const snapshot: ArtworkPublicationSnapshot = {
    ...f.snapshot,
    reservation: null,
    ownership: null,
    indexedMint: null,
    indexedEligible: false,
  };
  const mint = {
    finalized: false,
    unresolved: false,
    receipt: null as {
      status: "FINALIZED";
      signature: string;
      slot: string;
      indexed: boolean;
    } | null,
  };
  if (minted) {
    const asset = f.accounts.assetAccount.address,
      config = getKathaConfigDecoder().decode(f.accounts.configAccount.data);
    const encoded = getArtworkRecordEncoder().encode({
      ...getArtworkRecordDecoder().decode(f.accounts.artworkAccount.data),
      coreAsset: asset,
    });
    const data = new Uint8Array(f.accounts.artworkAccount.data.length);
    data.set(encoded);
    f.accounts.artworkAccount = { ...f.accounts.artworkAccount, data };
    const name = Buffer.from(snapshot.artwork.kathaId),
      uri = Buffer.from(snapshot.metadata!.uri!);
    const length = (n: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(n);
      return b;
    };
    const core = Buffer.concat([
      Buffer.from([1]),
      f.accounts.configAccount.data.slice(8 + 32, 8 + 64),
      Buffer.from([2]),
      f.accounts.configAccount.data.slice(8 + 32 * 5, 8 + 32 * 6),
      length(name.length),
      name,
      length(uri.length),
      uri,
      Buffer.from([0]),
    ]);
    f.accounts.assetAccount = {
      ...f.accounts.collectionAccount,
      address: asset,
      data: Uint8Array.from(core),
      space: BigInt(core.length),
      exists: true,
    };
    snapshot.metadata!.status = "FINALIZED";
    snapshot.metadata!.chainCluster = "LOCALNET";
    snapshot.metadata!.chainVersion = 1;
    snapshot.initialReport!.status = "FINALIZED";
    snapshot.initialReport!.chainCluster = "LOCALNET";
    snapshot.indexedEligible = true;
    snapshot.indexedMint = { signature: "AB".repeat(44), asset };
    snapshot.ownership = {
      artworkId: snapshot.artwork.id,
      cluster: "LOCALNET",
      assetAddress: asset,
      ownerWallet: config.registrationAuthority,
      sourceEventId: snapshot.artwork.id,
    };
    mint.finalized = true;
    mint.receipt = {
      status: "FINALIZED",
      signature: snapshot.indexedMint.signature,
      slot: "1",
      indexed: true,
    };
  }
  const review = vi.fn<ArtworkPublicationStore["review"]>(async () => snapshot),
    publish = vi.fn<ArtworkPublicationStore["publish"]>(async () => {
      snapshot.artwork.publishedAt = new Date();
      return snapshot.artwork;
    });
  const service = createArtworkMintAdministration(
    { review, publish },
    f.authorization,
    f.readChain,
    { ...f.storage, read: f.read },
    "localnet",
    async () => mint,
  );
  return {
    ...f,
    snapshot,
    mint,
    review,
    publish,
    service,
    input: {
      expectedUpdatedAt: snapshot.artwork.updatedAt.toISOString(),
      publicationConfirmed: true,
    },
  };
}
it("reviews deterministic mint readiness without exposing private inspection notes", async () => {
  const f = await fixture();
  const page = await f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId);
  expect(page.canMint).toBe(true);
  expect(page.canPublish).toBe(false);
  expect(page.chain?.asset).toBe(f.accounts.assetAccount.address);
  expect(JSON.stringify(page)).not.toContain(f.document.notes);
  expect(f.publish).not.toHaveBeenCalled();
});
it("publishes only a matching finalized indexed Core binding after explicit confirmation", async () => {
  const f = await fixture(true);
  expect(
    (await f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId)).canPublish,
  ).toBe(true);
  const page = await f.service.publish(
    "Bearer synthetic",
    f.snapshot.artwork.kathaId,
    f.input,
  );
  expect(page.published).toBe(true);
  expect(page.canPublish).toBe(false);
  expect(f.publish).toHaveBeenCalledOnce();
});
it.each([
  "unminted",
  "unconfirmed",
  "stale",
  "unindexed",
  "unknown",
  "wrong-signature",
  "wrong-asset",
  "wrong-owner",
  "artist",
  "metadata-version",
  "race",
  "cluster",
])("rejects publication %s", async (reason) => {
  const f = await fixture(reason !== "unminted");
  if (reason === "unconfirmed") f.input.publicationConfirmed = false;
  if (reason === "stale") f.input.expectedUpdatedAt = "2026-10-01T00:00:00.000Z";
  if (reason === "unindexed") f.mint.receipt!.indexed = false;
  if (reason === "unknown") f.mint.unresolved = true;
  if (reason === "wrong-signature") f.mint.receipt!.signature = "CD".repeat(44);
  if (reason === "wrong-asset") f.snapshot.indexedMint!.asset = f.session.walletAddress;
  if (reason === "wrong-owner")
    f.snapshot.ownership!.ownerWallet = "11111111111111111111111111111114";
  if (reason === "artist") {
    f.snapshot.artist!.verificationStatus = "UNVERIFIED";
    f.snapshot.indexedEligible = false;
  }
  if (reason === "metadata-version") f.snapshot.metadata!.chainVersion = 2;
  if (reason === "race") f.publish.mockResolvedValueOnce(null);
  if (reason === "cluster") f.session.cluster = "devnet";
  await expect(
    f.service.publish("Bearer synthetic", f.snapshot.artwork.kathaId, f.input),
  ).rejects.toThrow();
  if (reason !== "race") expect(f.publish).not.toHaveBeenCalled();
});
it("requires admin before reading the private publication snapshot", async () => {
  const f = await fixture();
  const auth = {
    ...f.authorization,
    requireRole: vi.fn(async () => {
      throw new Error("Denied");
    }),
  };
  const service = createArtworkMintAdministration(
    { review: f.review, publish: f.publish },
    auth,
    f.readChain,
    f.storage,
    "localnet",
    async () => f.mint,
  );
  await expect(service.review(undefined, f.snapshot.artwork.kathaId)).rejects.toThrow();
  await expect(
    service.publish(undefined, f.snapshot.artwork.kathaId, f.input),
  ).rejects.toThrow();
  expect(f.review).not.toHaveBeenCalled();
});
it("retains reservations and blocks unresolved or other-wallet preparations", async () => {
  const f = await fixture();
  f.snapshot.reservation = {
    idempotencyKey: "retained",
    walletAddress: "11111111111111111111111111111114",
    status: "UNKNOWN",
  };
  f.mint.unresolved = true;
  const page = await f.service.review("Bearer synthetic", f.snapshot.artwork.kathaId);
  expect(page.canMint).toBe(false);
  expect(page.blockedReasons).toContain("UNRESOLVED_MINT");
  expect(page.blockedReasons).toContain("OTHER_RESERVATION");
});

it("installs strict private mint review/publication routes and redacts infrastructure failures", async () => {
  const f = await fixture(true);
  const app = createApi(
    undefined,
    undefined,
    [],
    undefined,
    f.authorization,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      ...f.service,
      prepare: async () => {
        throw new Error("Unused preparation");
      },
    },
  );
  const path = `/admin/artworks/${f.snapshot.artwork.kathaId}`;
  const headers = {
    Authorization: "Bearer synthetic",
    "Content-Type": "application/json",
  };
  const review = await app.request(`${path}/minting`, { headers });
  expect(review.status).toBe(200);
  expect(review.headers.get("Cache-Control")).toBe("no-store");
  expect((await app.request(`${path}/minting?extra=true`, { headers })).status).toBe(
    400,
  );
  expect((await app.request(`${path}/minting`)).status).toBe(401);
  expect(
    (
      await app.request(`${path}/publication`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...f.input, notes: "private" }),
      })
    ).status,
  ).toBe(400);
  f.readChain.mockRejectedValueOnce(new Error("PRIVATE_RPC_SENTINEL"));
  const unavailable = await app.request(`${path}/publication`, {
    method: "POST",
    headers,
    body: JSON.stringify(f.input),
  });
  expect(unavailable.status).toBe(500);
  expect(await unavailable.text()).not.toContain("PRIVATE_RPC_SENTINEL");
  const published = await app.request(`${path}/publication`, {
    method: "POST",
    headers,
    body: JSON.stringify(f.input),
  });
  expect(published.status).toBe(200);
  expect(published.headers.get("Cache-Control")).toBe("no-store");
});
