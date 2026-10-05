import { kathaIdSchema } from "@katha/shared";
import * as registry from "./generated/registry/index.js";

// Exact codec round trips reject trailing or noncanonical bytes.
export function decodeRegistryEvent(data: Uint8Array) {
  const prefix = Buffer.from(data.subarray(0, 8));
  if (data.length < 8 || data.length > 8192) throw new Error("Invalid event size");
  if (prefix.equals(Buffer.from(registry.PLATFORM_INITIALIZED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getPlatformInitializedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    return { name: "PlatformInitialized" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.ARTWORK_REGISTERED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getArtworkRegisteredEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "ArtworkRegistered" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.ARTWORK_VERIFIED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getArtworkVerifiedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "ArtworkVerified" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.METADATA_COMMITTED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getMetadataCommittedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "MetadataCommitted" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.CONDITION_RECORDED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getConditionRecordedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "ConditionRecorded" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.CUSTODY_UPDATED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getCustodyUpdatedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "CustodyUpdated" as const, value };
  }
  if (prefix.equals(Buffer.from(registry.ARTWORK_MINTED_EVENT_DISCRIMINATOR))) {
    const codec = registry.getArtworkMintedEventCodec();
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    kathaIdSchema.parse(value.kathaId);
    return { name: "ArtworkMinted" as const, value };
  }
  throw new Error("Unsupported Registry event");
}
export type RegistryActivityEvent = ReturnType<typeof decodeRegistryEvent>;
