import {
  unsignedOperationResponseSchema,
  listingPreparationResponseSchema,
  type UnsignedOperationResponse,
  type ListingPreparationResponse,
} from "@katha/shared";
export type WalletOperation =
  UnsignedOperationResponse | (ListingPreparationResponse & { kind: "CREATE_LISTING" });
export function parseWalletOperation(value: unknown): WalletOperation {
  const listing = listingPreparationResponseSchema.safeParse(value);
  if (listing.success && listing.data.kind === "CREATE_LISTING")
    return { ...listing.data, kind: "CREATE_LISTING" };
  return unsignedOperationResponseSchema.parse(value);
}
