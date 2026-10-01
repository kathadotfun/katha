import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  getProgramDerivedAddress,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { KATHA_MARKETPLACE_PROGRAM_ADDRESS } from "../src/generated/marketplace/index.js";
import {
  ArtworkCategory,
  findArtworkPda,
  getMetadataCommittedEventEncoder,
  getMetadataHeadDecoder,
  getMetadataHeadEncoder,
  getMetadataHeadSize,
  getRegisterArtworkInstructionAsync,
  getReviseMintedMetadataInstructionDataEncoder,
  identifyKathaRegistryAccount,
  identifyKathaRegistryEvent,
  identifyKathaRegistryInstruction,
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  KathaRegistryAccount,
  KathaRegistryEvent,
  KathaRegistryInstruction,
  parseMetadataCommittedEvent,
  parseRegisterArtworkInstruction,
} from "../src/generated/registry/index.js";

const system = address("11111111111111111111111111111111");
const other = address("Vote111111111111111111111111111111111111111");

describe("generated program clients", () => {
  it("exposes the addresses of both reviewed Anchor IDLs", () => {
    for (const [program, expected] of [
      ["registry", KATHA_REGISTRY_PROGRAM_ADDRESS],
      ["marketplace", KATHA_MARKETPLACE_PROGRAM_ADDRESS],
    ]) {
      const idl = JSON.parse(
        readFileSync(
          new URL(`../../../target/idl/katha_${program}.json`, import.meta.url),
          "utf8",
        ),
      );
      expect(expected).toBe(idl.address);
    }
  });

  it("derives the artwork PDA from the permanent ID bytes", async () => {
    const kathaId = "KATHA-PAUBHA-000001";
    expect(await findArtworkPda({ kathaId })).toEqual(
      await getProgramDerivedAddress({
        programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
        seeds: [new TextEncoder().encode("artwork"), new TextEncoder().encode(kathaId)],
      }),
    );
  });

  it("encodes registration signer roles and the Anchor discriminator", async () => {
    const authority = await generateKeyPairSigner();
    const instruction = await getRegisterArtworkInstructionAsync({
      registrationAuthority: authority,
      kathaId: "KATHA-PAUBHA-000001",
      artistId: "123e4567-e89b-42d3-a456-426614174000",
      creatorWallet: null,
      category: ArtworkCategory.Paubha,
      creationYear: 2025,
      authorshipEvidenceHash: new Uint8Array(32).fill(7),
    });
    expect(Array.from(instruction.data.subarray(0, 8))).toEqual(
      Array.from(
        createHash("sha256").update("global:register_artwork").digest().subarray(0, 8),
      ),
    );
    expect(instruction.accounts.map(({ role }) => role)).toEqual([
      AccountRole.READONLY,
      AccountRole.WRITABLE,
      AccountRole.WRITABLE_SIGNER,
      AccountRole.READONLY,
    ]);
    expect(identifyKathaRegistryInstruction(instruction)).toBe(
      KathaRegistryInstruction.RegisterArtwork,
    );
    expect(parseRegisterArtworkInstruction(instruction).data.kathaId).toBe(
      "KATHA-PAUBHA-000001",
    );
    expect(() =>
      parseRegisterArtworkInstruction({ ...instruction, accounts: [] }),
    ).toThrow();
  });

  it("uses little-endian versions and byte lengths for minted metadata", () => {
    const hash = new Uint8Array(32).fill(9);
    const uri = "https://katha.fun/metadata/v4.json";
    const bytes = getReviseMintedMetadataInstructionDataEncoder().encode({
      expectedVersion: 3,
      nextVersion: 4,
      documentHash: hash,
      uri,
    });
    const buffer = Uint8Array.from(bytes);
    const view = new DataView(buffer.buffer);
    expect(view.getUint32(8, true)).toBe(3);
    expect(view.getUint32(12, true)).toBe(4);
    expect(buffer.subarray(16, 48)).toEqual(hash);
    expect(view.getUint32(48, true)).toBe(new TextEncoder().encode(uri).length);
    expect(new TextDecoder().decode(buffer.subarray(52))).toBe(uri);
  });

  it("decodes fixed account layouts and rejects truncated data", () => {
    const data = getMetadataHeadEncoder().encode({
      artwork: system,
      version: 4,
      currentRevision: other,
      currentHash: new Uint8Array(32).fill(9),
      bump: 254,
    });
    expect(data.length).toBe(109);
    expect(getMetadataHeadSize()).toBe(109);
    expect(identifyKathaRegistryAccount(data)).toBe(KathaRegistryAccount.MetadataHead);
    expect(getMetadataHeadDecoder().decode(data)).toMatchObject({
      artwork: system,
      version: 4,
      currentRevision: other,
      bump: 254,
    });
    expect(() => getMetadataHeadDecoder().decode(data.subarray(0, 50))).toThrow();
    expect(() => identifyKathaRegistryAccount(new Uint8Array(109))).toThrow();
  });

  it("decodes events and rejects unrelated discriminators", () => {
    const event = {
      artwork: system,
      kathaId: "KATHA-PAUBHA-000001",
      revision: other,
      version: 4,
      documentHash: new Uint8Array(32).fill(9),
      committedBy: system,
      committedAt: 1_800_000_000n,
    };
    const data = getMetadataCommittedEventEncoder().encode(event);
    expect(identifyKathaRegistryEvent(data)).toBe(KathaRegistryEvent.MetadataCommitted);
    expect(parseMetadataCommittedEvent(data)).toEqual(event);
    const wrong = Uint8Array.from(data);
    wrong.fill(0, 0, 8);
    expect(() => parseMetadataCommittedEvent(wrong)).toThrow();
    expect(() => parseMetadataCommittedEvent(data.subarray(0, 20))).toThrow();
  });
});
