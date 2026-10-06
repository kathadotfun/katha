import { sql } from "drizzle-orm";
// Called while holding the artwork lock; receipt insertion takes the matching shared lock.
export function unresolvedCondition(artworkId: string, cluster: "LOCALNET" | "DEVNET") {
  return sql<boolean>`exists (select 1 from transaction_receipts as receipt inner join blockchain_operations as operation on operation.id = receipt.operation_id where operation.artwork_id = ${artworkId} and operation.kind = 'RECORD_CONDITION' and operation.cluster = ${cluster} and receipt.cluster = ${cluster} and receipt.status = 'UNKNOWN')`;
}

export function finalizedCondition(
  artworkId: string,
  cluster: "LOCALNET" | "DEVNET",
  reportHash: string,
) {
  return sql<boolean>`exists (select 1 from transaction_receipts as receipt inner join blockchain_operations as operation on operation.id = receipt.operation_id where operation.artwork_id = ${artworkId} and operation.kind = 'RECORD_CONDITION' and operation.cluster = ${cluster} and receipt.cluster = ${cluster} and receipt.status = 'FINALIZED' and ${reportHash} = any(operation.expected_hashes))`;
}
