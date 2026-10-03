CREATE TYPE "public"."blockchain_operation_kind" AS ENUM('REGISTER_ARTWORK', 'VERIFY_ARTWORK', 'RECORD_CONDITION', 'UPDATE_CUSTODY', 'MINT_ARTWORK', 'REVISE_METADATA', 'CREATE_LISTING', 'CANCEL_LISTING', 'PURCHASE_ARTWORK');--> statement-breakpoint
CREATE TYPE "public"."blockchain_operation_status" AS ENUM('PREPARED', 'UNKNOWN', 'FAILED', 'FINALIZED');--> statement-breakpoint
CREATE TYPE "public"."transaction_receipt_status" AS ENUM('UNKNOWN', 'FAILED', 'FINALIZED');--> statement-breakpoint
CREATE TABLE "blockchain_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"wallet_id" uuid NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"kind" "blockchain_operation_kind" NOT NULL,
	"idempotency_key" varchar(128) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"program_address" varchar(44) NOT NULL,
	"expected_accounts" varchar(44)[] NOT NULL,
	"expected_hashes" varchar(64)[] NOT NULL,
	"status" "blockchain_operation_status" DEFAULT 'PREPARED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockchain_operations_idempotency_unique" UNIQUE("wallet_id","cluster","idempotency_key"),
	CONSTRAINT "blockchain_operations_id_cluster_unique" UNIQUE("id","cluster"),
	CONSTRAINT "blockchain_operations_key_format" CHECK ("blockchain_operations"."idempotency_key" ~ '^[A-Za-z0-9_-]{1,128}$'),
	CONSTRAINT "blockchain_operations_request_hash_format" CHECK ("blockchain_operations"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "blockchain_operations_program_format" CHECK ("blockchain_operations"."program_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "blockchain_operations_accounts_valid" CHECK (cardinality("blockchain_operations"."expected_accounts") BETWEEN 1 AND 64 AND array_ndims("blockchain_operations"."expected_accounts") = 1 AND array_position("blockchain_operations"."expected_accounts", NULL) IS NULL AND array_to_string("blockchain_operations"."expected_accounts", ',') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}(,[1-9A-HJ-NP-Za-km-z]{32,44})*$'),
	CONSTRAINT "blockchain_operations_hashes_valid" CHECK (cardinality("blockchain_operations"."expected_hashes") BETWEEN 0 AND 32 AND (cardinality("blockchain_operations"."expected_hashes") = 0 OR (array_ndims("blockchain_operations"."expected_hashes") = 1 AND array_position("blockchain_operations"."expected_hashes", NULL) IS NULL AND array_to_string("blockchain_operations"."expected_hashes", ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'))),
	CONSTRAINT "blockchain_operations_time_order" CHECK (isfinite("blockchain_operations"."created_at") AND isfinite("blockchain_operations"."updated_at") AND "blockchain_operations"."updated_at" >= "blockchain_operations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "transaction_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"signature" varchar(88) NOT NULL,
	"message_hash" varchar(64) NOT NULL,
	"status" "transaction_receipt_status" DEFAULT 'UNKNOWN' NOT NULL,
	"failure_code" varchar(64),
	"slot" bigint,
	"chain_recorded_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_receipts_signature_unique" UNIQUE("cluster","signature"),
	CONSTRAINT "transaction_receipts_signature_format" CHECK ("transaction_receipts"."signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
	CONSTRAINT "transaction_receipts_message_hash_format" CHECK ("transaction_receipts"."message_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "transaction_receipts_outcome_complete" CHECK (("transaction_receipts"."status" = 'UNKNOWN' AND "transaction_receipts"."failure_code" IS NULL AND "transaction_receipts"."slot" IS NULL AND "transaction_receipts"."chain_recorded_at" IS NULL AND "transaction_receipts"."finalized_at" IS NULL) OR ("transaction_receipts"."status" = 'FAILED' AND "transaction_receipts"."failure_code" IS NOT NULL AND "transaction_receipts"."failure_code" ~ '^[A-Z0-9_]{1,64}$' AND "transaction_receipts"."slot" IS NULL AND "transaction_receipts"."chain_recorded_at" IS NULL AND "transaction_receipts"."finalized_at" IS NULL) OR ("transaction_receipts"."status" = 'FINALIZED' AND "transaction_receipts"."failure_code" IS NULL AND "transaction_receipts"."slot" IS NOT NULL AND "transaction_receipts"."slot" >= 0 AND "transaction_receipts"."chain_recorded_at" IS NOT NULL AND isfinite("transaction_receipts"."chain_recorded_at") AND "transaction_receipts"."finalized_at" IS NOT NULL AND isfinite("transaction_receipts"."finalized_at") AND "transaction_receipts"."finalized_at" >= "transaction_receipts"."chain_recorded_at" AND "transaction_receipts"."observed_at" >= "transaction_receipts"."finalized_at")),
	CONSTRAINT "transaction_receipts_time_order" CHECK (isfinite("transaction_receipts"."created_at") AND isfinite("transaction_receipts"."observed_at") AND "transaction_receipts"."observed_at" >= "transaction_receipts"."created_at")
);
--> statement-breakpoint
ALTER TABLE "blockchain_operations" ADD CONSTRAINT "blockchain_operations_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "blockchain_operations" ADD CONSTRAINT "blockchain_operations_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "transaction_receipts" ADD CONSTRAINT "transaction_receipts_operation_cluster_fk" FOREIGN KEY ("operation_id","cluster") REFERENCES "public"."blockchain_operations"("id","cluster") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "blockchain_operations_artwork_index" ON "blockchain_operations" USING btree ("artwork_id");--> statement-breakpoint
CREATE INDEX "transaction_receipts_operation_index" ON "transaction_receipts" USING btree ("operation_id");--> statement-breakpoint
-- Custom reconciliation guards are not represented in Drizzle table snapshots.
CREATE FUNCTION public.protect_blockchain_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE expected_status public.blockchain_operation_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Operation history and idempotency keys are permanent'
      USING ERRCODE = '23514', CONSTRAINT = 'blockchain_operations_permanent';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PREPARED' THEN
      RAISE EXCEPTION 'Operations start prepared'
        USING ERRCODE = '23514', CONSTRAINT = 'blockchain_operations_prepared_insert';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'Operation expectations cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'blockchain_operations_immutable';
  END IF;
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.transaction_receipts WHERE operation_id = OLD.id AND status = 'FINALIZED') THEN 'FINALIZED'
    WHEN EXISTS (SELECT 1 FROM public.transaction_receipts WHERE operation_id = OLD.id AND status = 'UNKNOWN') THEN 'UNKNOWN'
    WHEN EXISTS (SELECT 1 FROM public.transaction_receipts WHERE operation_id = OLD.id) THEN 'FAILED'
    ELSE 'PREPARED' END INTO expected_status;
  IF NEW.status IS DISTINCT FROM expected_status THEN
    RAISE EXCEPTION 'Operation status must match receipts'
      USING ERRCODE = '23514', CONSTRAINT = 'blockchain_operations_receipt_status';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER blockchain_operations_protect BEFORE INSERT OR UPDATE OR DELETE ON public.blockchain_operations
FOR EACH ROW EXECUTE FUNCTION public.protect_blockchain_operation();
--> statement-breakpoint
CREATE FUNCTION public.protect_transaction_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE operation public.blockchain_operations%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Transaction attempt history is permanent'
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_receipts_permanent';
  END IF;
  SELECT * INTO operation FROM public.blockchain_operations WHERE id = NEW.operation_id FOR UPDATE;
  IF NOT FOUND OR NEW.cluster IS DISTINCT FROM operation.cluster THEN
    RAISE EXCEPTION 'Receipt must match operation and cluster'
      USING ERRCODE = '23503', CONSTRAINT = 'transaction_receipts_operation_cluster_fk';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'UNKNOWN' OR operation.status = 'FINALIZED' THEN
      RAISE EXCEPTION 'Attempts start unknown and cannot follow finalized success'
        USING ERRCODE = '23514', CONSTRAINT = 'transaction_receipts_unknown_insert';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.observed_at := NEW.created_at;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'failure_code', 'slot', 'chain_recorded_at', 'finalized_at', 'observed_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'failure_code', 'slot', 'chain_recorded_at', 'finalized_at', 'observed_at']) THEN
    RAISE EXCEPTION 'Transaction attempt identity cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_receipts_immutable';
  END IF;
  IF OLD.status <> 'UNKNOWN' THEN
    RAISE EXCEPTION 'Terminal receipt cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_receipts_terminal';
  END IF;
  IF NEW.status = 'FINALIZED' AND operation.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'Only one successful attempt can finalize an operation'
      USING ERRCODE = '23514', CONSTRAINT = 'transaction_receipts_one_success';
  END IF;
  NEW.observed_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transaction_receipts_protect BEFORE INSERT OR UPDATE OR DELETE ON public.transaction_receipts
FOR EACH ROW EXECUTE FUNCTION public.protect_transaction_receipt();
--> statement-breakpoint
CREATE FUNCTION public.synchronize_blockchain_operation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.blockchain_operations SET status = (CASE
    WHEN EXISTS (SELECT 1 FROM public.transaction_receipts WHERE operation_id = NEW.operation_id AND status = 'FINALIZED') THEN 'FINALIZED'
    WHEN EXISTS (SELECT 1 FROM public.transaction_receipts WHERE operation_id = NEW.operation_id AND status = 'UNKNOWN') THEN 'UNKNOWN'
    ELSE 'FAILED' END)::public.blockchain_operation_status
  WHERE id = NEW.operation_id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transaction_receipts_sync AFTER INSERT OR UPDATE ON public.transaction_receipts
FOR EACH ROW EXECUTE FUNCTION public.synchronize_blockchain_operation();
