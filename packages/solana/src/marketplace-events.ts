import * as marketplace from "./generated/marketplace/index.js";

export function decodeMarketplaceEvent(data: Uint8Array) {
  if (data.length < 8 || data.length > 8192) throw new Error("Invalid event size");
  const prefix = Buffer.from(data.subarray(0, 8));
  const read = <A, T extends A>(codec: {
    decode(data: Uint8Array): T;
    encode(value: A): ArrayLike<number>;
  }) => {
    const value = codec.decode(data);
    if (!Buffer.from(codec.encode(value)).equals(data))
      throw new Error("Invalid event bytes");
    return value;
  };
  if (
    prefix.equals(Buffer.from(marketplace.MARKETPLACE_INITIALIZED_EVENT_DISCRIMINATOR))
  )
    return {
      name: "MarketplaceInitialized" as const,
      value: read(marketplace.getMarketplaceInitializedEventCodec()),
    };
  if (prefix.equals(Buffer.from(marketplace.LISTING_CREATED_EVENT_DISCRIMINATOR)))
    return {
      name: "ListingCreated" as const,
      value: read(marketplace.getListingCreatedEventCodec()),
    };
  if (prefix.equals(Buffer.from(marketplace.LISTING_RELEASED_EVENT_DISCRIMINATOR)))
    return {
      name: "ListingReleased" as const,
      value: read(marketplace.getListingReleasedEventCodec()),
    };
  if (prefix.equals(Buffer.from(marketplace.ARTWORK_PURCHASED_EVENT_DISCRIMINATOR)))
    return {
      name: "ArtworkPurchased" as const,
      value: read(marketplace.getArtworkPurchasedEventCodec()),
    };
  throw new Error("Unsupported Marketplace event");
}
export type MarketplaceActivityEvent = ReturnType<typeof decodeMarketplaceEvent>;
