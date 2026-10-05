CREATE TABLE "operation_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"canonical_request" text NOT NULL,
	"message_hash" varchar(64) NOT NULL,
	"transaction_base64" text NOT NULL,
	"transaction_version" integer NOT NULL,
	"blockhash" varchar(44) NOT NULL,
	"last_valid_block_height" bigint NOT NULL,
	"simulation_slot" bigint NOT NULL,
	"simulation_units" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_preparations_message_unique" UNIQUE("operation_id","message_hash"),
	CONSTRAINT "operation_preparations_request_bound" CHECK (octet_length("operation_preparations"."canonical_request") BETWEEN 2 AND 65536 AND jsonb_typeof("operation_preparations"."canonical_request"::jsonb) = 'object'),
	CONSTRAINT "operation_preparations_hash_format" CHECK ("operation_preparations"."message_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "operation_preparations_wire_format" CHECK (length("operation_preparations"."transaction_base64") BETWEEN 4 AND 5464 AND "operation_preparations"."transaction_base64" ~ '^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'),
	CONSTRAINT "operation_preparations_version_valid" CHECK ("operation_preparations"."transaction_version" IN (0,1)),
	CONSTRAINT "operation_preparations_blockhash_format" CHECK ("operation_preparations"."blockhash" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "operation_preparations_numbers_valid" CHECK ("operation_preparations"."last_valid_block_height" >= 0 AND "operation_preparations"."simulation_slot" >= 0 AND ("operation_preparations"."simulation_units" IS NULL OR "operation_preparations"."simulation_units" >= 0) AND isfinite("operation_preparations"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "operation_preparations" ADD CONSTRAINT "operation_preparations_operation_id_blockchain_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."blockchain_operations"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
-- History guards and cross-table hashes are not represented in Drizzle snapshots.
CREATE FUNCTION public.protect_operation_preparation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE operation public.blockchain_operations%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Prepared messages are immutable history'
      USING ERRCODE = '23514', CONSTRAINT = 'operation_preparations_permanent';
  END IF;
  SELECT * INTO operation FROM public.blockchain_operations WHERE id = NEW.operation_id FOR UPDATE;
  IF operation.status <> 'PREPARED' OR operation.request_hash <> encode(sha256(convert_to(NEW.canonical_request, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'Preparation must match a prepared operation intent'
      USING ERRCODE = '23514', CONSTRAINT = 'operation_preparations_intent_match';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER operation_preparations_protect BEFORE INSERT OR UPDATE OR DELETE ON public.operation_preparations
FOR EACH ROW EXECUTE FUNCTION public.protect_operation_preparation();
