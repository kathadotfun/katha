import { generateKeyPairSync, sign } from "node:crypto";

/** Temporary test identity: never serialized or written to disk. */
export function temporaryWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const bytes = Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let address = "";
  while (value > 0n) {
    address = alphabet[Number(value % 58n)] + address;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    address = "1" + address;
  }
  return {
    address,
    signBytes: (message: Uint8Array) => sign(null, message, privateKey),
    signMessage: (message: string) =>
      sign(null, Buffer.from(message, "utf8"), privateKey).toString("base64"),
  };
}
