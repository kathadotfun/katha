import { generateKeyPair, getAddressFromPublicKey, signBytes } from "@solana/kit";
import { expect, it } from "vitest";
import {
  validateWalletAddress,
  verifyWalletSignature,
} from "../src/wallet-signature.js";

it("verifies exact Ed25519 message bytes with decoded wallet addresses", async () => {
  const wallet = await generateKeyPair();
  const address = await getAddressFromPublicKey(wallet.publicKey);
  const bytes = new TextEncoder().encode("Synthetic sign-in challenge");
  const signature = await signBytes(wallet.privateKey, bytes);
  expect(await verifyWalletSignature(address, bytes, new Uint8Array(signature))).toBe(
    true,
  );
  expect(
    await verifyWalletSignature(
      address,
      new TextEncoder().encode("Altered"),
      new Uint8Array(signature),
    ),
  ).toBe(false);
  const other = await generateKeyPair();
  expect(
    await verifyWalletSignature(
      await getAddressFromPublicKey(other.publicKey),
      bytes,
      new Uint8Array(signature),
    ),
  ).toBe(false);
});
it("rejects malformed address bytes and signature length", async () => {
  expect(() => validateWalletAddress("z".repeat(44))).toThrow();
  expect(
    await verifyWalletSignature("1".repeat(32), new Uint8Array(0), new Uint8Array(63)),
  ).toBe(false);
});
