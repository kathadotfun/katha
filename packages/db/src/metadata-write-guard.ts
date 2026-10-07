import { sql } from "drizzle-orm";
// The caller holds the artwork lock; receipt insertion takes the matching shared lock.
export function unresolvedMetadata(artworkId: string, cluster: "LOCALNET" | "DEVNET") {
  return sql<boolean>`exists (select 1 from transaction_receipts as receipt inner join blockchain_operations as operation on operation.id = receipt.operation_id where operation.artwork_id = ${artworkId} and operation.kind = 'REVISE_METADATA' and operation.cluster = ${cluster} and receipt.cluster = ${cluster} and receipt.status = 'UNKNOWN')`;
}
