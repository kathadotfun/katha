CREATE TABLE "indexer_networks" (
	"cluster" "attestation_cluster" NOT NULL,
	"registry_program" varchar(44) NOT NULL,
	"collection" varchar(44) NOT NULL,
	"genesis_hash" varchar(44) NOT NULL,
	"finalized_slot" bigint NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_networks_cluster_registry_program_pk" PRIMARY KEY("cluster","registry_program"),
	CONSTRAINT "indexer_networks_values_valid" CHECK ("indexer_networks"."registry_program" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "indexer_networks"."collection" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "indexer_networks"."genesis_hash" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "indexer_networks"."finalized_slot" >= 0 AND isfinite("indexer_networks"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "ownership_reconciliations" (
	"cluster" "attestation_cluster" NOT NULL,
	"artwork_id" uuid NOT NULL,
	"source_event_id" uuid NOT NULL,
	"indexed_owner" varchar(44) NOT NULL,
	"observed_owner" varchar(44),
	"observed_slot" bigint NOT NULL,
	"status" varchar(16) NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ownership_reconciliations_cluster_artwork_id_pk" PRIMARY KEY("cluster","artwork_id"),
	CONSTRAINT "ownership_reconciliations_values_valid" CHECK ("ownership_reconciliations"."indexed_owner" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ("ownership_reconciliations"."observed_owner" IS NULL OR "ownership_reconciliations"."observed_owner" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') AND "ownership_reconciliations"."observed_slot" >= 0 AND isfinite("ownership_reconciliations"."checked_at") AND (("ownership_reconciliations"."status" = 'MATCH' AND "ownership_reconciliations"."observed_owner" IS NOT NULL AND "ownership_reconciliations"."observed_owner" = "ownership_reconciliations"."indexed_owner") OR ("ownership_reconciliations"."status" = 'MISMATCH' AND "ownership_reconciliations"."observed_owner" IS NOT NULL AND "ownership_reconciliations"."observed_owner" <> "ownership_reconciliations"."indexed_owner") OR ("ownership_reconciliations"."status" IN ('MISSING', 'INVALID') AND "ownership_reconciliations"."observed_owner" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "indexer_checkpoints" ADD COLUMN "gap_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "ownership_reconciliations" ADD CONSTRAINT "ownership_reconciliations_event_fk" FOREIGN KEY ("source_event_id","cluster","artwork_id") REFERENCES "public"."indexed_events"("id","cluster","artwork_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "indexer_checkpoints" ADD CONSTRAINT "indexer_checkpoints_gap_reason_valid" CHECK ("indexer_checkpoints"."gap_reason" IS NULL OR ("indexer_checkpoints"."gap_from_slot" IS NOT NULL AND "indexer_checkpoints"."gap_reason" IN ('HISTORY_UNAVAILABLE', 'BOUNDARY_MISSING', 'PAGE_LIMIT', 'EVIDENCE_INVALID', 'OWNER_MISMATCH', 'NETWORK_CHANGED', 'NETWORK_UNBOUND')));--> statement-breakpoint
CREATE FUNCTION public.protect_indexer_network() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' OR ROW(NEW.cluster, NEW.registry_program, NEW.collection, NEW.genesis_hash)
    IS DISTINCT FROM ROW(OLD.cluster, OLD.registry_program, OLD.collection, OLD.genesis_hash)
    OR NEW.finalized_slot < OLD.finalized_slot OR (OLD.blocked AND NOT NEW.blocked) THEN
    RAISE EXCEPTION 'Indexer network identity cannot change or resume after a reset'
      USING ERRCODE = '23514', CONSTRAINT = 'indexer_networks_immutable';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER indexer_networks_protect BEFORE UPDATE OR DELETE ON public.indexer_networks
FOR EACH ROW EXECUTE FUNCTION public.protect_indexer_network();
--> statement-breakpoint
CREATE FUNCTION public.bind_ownership_reconciliation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE projection public.artwork_ownership%ROWTYPE; source public.indexed_events%ROWTYPE;
BEGIN
  SELECT * INTO projection FROM public.artwork_ownership WHERE cluster = NEW.cluster AND artwork_id = NEW.artwork_id;
  SELECT * INTO source FROM public.indexed_events WHERE id = NEW.source_event_id;
  IF projection.source_event_id IS DISTINCT FROM NEW.source_event_id OR projection.owner_wallet IS DISTINCT FROM NEW.indexed_owner
    OR source.id IS NULL OR NEW.observed_slot < source.slot THEN
    RAISE EXCEPTION 'Reconciliation must bind current indexed ownership and finalized evidence'
      USING ERRCODE = '23514', CONSTRAINT = 'ownership_reconciliations_binding';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.observed_slot < OLD.observed_slot THEN
    RAISE EXCEPTION 'Reconciliation evidence cannot rewind'
      USING ERRCODE = '23514', CONSTRAINT = 'ownership_reconciliations_monotonic';
  END IF;
  NEW.checked_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ownership_reconciliations_bind BEFORE INSERT OR UPDATE ON public.ownership_reconciliations
FOR EACH ROW EXECUTE FUNCTION public.bind_ownership_reconciliation();
