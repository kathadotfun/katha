import {
  purchasePreparationResponseSchema,
  type PurchasePreparationResponse,
  unsignedOperationResponseSchema,
  listingPreparationResponseSchema,
  type UnsignedOperationResponse,
  type ListingPreparationResponse,
} from "@katha/shared";
export type WalletOperation =
  | PurchasePreparationResponse
  | UnsignedOperationResponse
  | (ListingPreparationResponse & { kind: "CREATE_LISTING" | "CANCEL_LISTING" });
export function parseWalletOperation(value: unknown): WalletOperation {
  const purchase = purchasePreparationResponseSchema.safeParse(value);
  if (purchase.success) return purchase.data;
  const listing = listingPreparationResponseSchema.safeParse(value);
  if (listing.success) return listing.data;
  return unsignedOperationResponseSchema.parse(value);
}
