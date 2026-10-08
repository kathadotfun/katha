import {
  unsignedOperationResponseSchema,
  listingPreparationResponseSchema,
  type UnsignedOperationResponse,
  type ListingPreparationResponse,
} from "@katha/shared";
export type WalletOperation =
  | UnsignedOperationResponse
  | (ListingPreparationResponse & { kind: "CREATE_LISTING" | "CANCEL_LISTING" });
export function parseWalletOperation(value: unknown): WalletOperation {
  const listing = listingPreparationResponseSchema.safeParse(value);
  if (listing.success) return listing.data;
  return unsignedOperationResponseSchema.parse(value);
}
