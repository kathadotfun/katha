import { StorageError, type StorageMime } from "./storage.js";

export function validateStorageBytes(
  bytes: Uint8Array,
  mime: StorageMime,
  maxBytes: number,
) {
  if (bytes.length === 0) throw new StorageError("INVALID_OBJECT");
  if (
    bytes.length > maxBytes ||
    (mime === "application/json" && bytes.length > 1024 * 1024)
  )
    throw new StorageError("TOO_LARGE");
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start: number, end: number) => buffer.toString("ascii", start, end);
  let matches = false;
  switch (mime) {
    case "image/png":
      matches =
        buffer.length >= 24 &&
        buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        text(12, 16) === "IHDR";
      break;
    case "image/jpeg":
      matches =
        buffer.length >= 4 &&
        buffer[0] === 255 &&
        buffer[1] === 216 &&
        buffer[2] === 255 &&
        buffer.at(-2) === 255 &&
        buffer.at(-1) === 217;
      break;
    case "image/webp":
      matches =
        buffer.length >= 16 &&
        text(0, 4) === "RIFF" &&
        text(8, 12) === "WEBP" &&
        ["VP8 ", "VP8L", "VP8X"].includes(text(12, 16));
      break;
    case "image/avif":
      matches =
        buffer.length >= 16 &&
        text(4, 8) === "ftyp" &&
        ["avif", "avis"].includes(text(8, 12));
      break;
    case "video/mp4":
      matches =
        buffer.length >= 16 &&
        text(4, 8) === "ftyp" &&
        ["isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  "].includes(text(8, 12));
      break;
    case "video/webm":
      matches =
        buffer.length >= 8 &&
        buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])) &&
        buffer.includes(Buffer.from("webm"));
      break;
    case "application/pdf":
      matches =
        text(0, 5) === "%PDF-" &&
        buffer
          .subarray(Math.max(0, buffer.length - 1024))
          .includes(Buffer.from("%%EOF"));
      break;
    case "application/json":
      try {
        const value: unknown = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
        matches = value !== null && typeof value === "object" && !Array.isArray(value);
      } catch {
        matches = false;
      }
      break;
  }
  if (!matches) throw new StorageError("INVALID_OBJECT");
}
