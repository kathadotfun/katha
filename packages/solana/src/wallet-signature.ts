import {
  address,
  getAddressEncoder,
  getPublicKeyFromAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";

export function validateWalletAddress(value: string): void {
  getAddressEncoder().encode(address(value));
}

/** Verifies exact signMessage bytes; never signs, submits, or reads private keys. */
export async function verifyWalletSignature(
  wallet: string,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    validateWalletAddress(wallet);
    const key = await getPublicKeyFromAddress(address(wallet));
    return await verifySignature(key, signatureBytes(signature), message);
  } catch {
    return false;
  }
}
