CREATE TYPE "public"."indexed_event_kind" AS ENUM('REGISTRY', 'OWNERSHIP', 'LISTING', 'SALE');--> statement-breakpoint
CREATE TYPE "public"."indexed_listing_status" AS ENUM('ACTIVE', 'CANCELLED', 'PURCHASED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "artwork_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"artwork_id" uuid NOT NULL,
	"asset_address" varchar(44) NOT NULL,
	"source_event_id" uuid NOT NULL,
	"listing_address" varchar(44) NOT NULL,
	"seller_wallet" varchar(44) NOT NULL,
	"payment_mint" varchar(44) NOT NULL,
	"price" numeric NOT NULL,
	"status" "indexed_listing_status" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "artwork_listings_address_unique" UNIQUE("cluster","listing_address"),
	CONSTRAINT "artwork_listings_sale_reference_unique" UNIQUE("id","cluster","artwork_id"),
	CONSTRAINT "artwork_listings_addresses_valid" CHECK ("artwork_listings"."asset_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_listings"."listing_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_listings"."seller_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_listings"."payment_mint" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "artwork_listings_price_valid" CHECK (scale("artwork_listings"."price") = 0 AND "artwork_listings"."price" BETWEEN 1 AND 18446744073709551615),
	CONSTRAINT "artwork_listings_expiry_finite" CHECK (isfinite("artwork_listings"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "artwork_ownership" (
	"cluster" "attestation_cluster" NOT NULL,
	"artwork_id" uuid NOT NULL,
	"asset_address" varchar(44) NOT NULL,
	"source_event_id" uuid NOT NULL,
	"owner_wallet" varchar(44) NOT NULL,
	CONSTRAINT "artwork_ownership_cluster_artwork_id_pk" PRIMARY KEY("cluster","artwork_id"),
	CONSTRAINT "artwork_ownership_asset_unique" UNIQUE("cluster","asset_address"),
	CONSTRAINT "artwork_ownership_addresses_valid" CHECK ("artwork_ownership"."asset_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_ownership"."owner_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "artwork_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"artwork_id" uuid NOT NULL,
	"asset_address" varchar(44) NOT NULL,
	"source_event_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"buyer_wallet" varchar(44) NOT NULL,
	"seller_wallet" varchar(44) NOT NULL,
	"payment_mint" varchar(44) NOT NULL,
	"price" numeric NOT NULL,
	"is_primary" boolean NOT NULL,
	"proceeds_wallet" varchar(44) NOT NULL,
	"proceeds_amount" numeric NOT NULL,
	"artist_wallet" varchar(44) NOT NULL,
	"royalty_amount" numeric NOT NULL,
	"treasury_wallet" varchar(44) NOT NULL,
	"platform_fee" numeric NOT NULL,
	CONSTRAINT "artwork_sales_listing_unique" UNIQUE("listing_id"),
	CONSTRAINT "artwork_sales_event_unique" UNIQUE("source_event_id"),
	CONSTRAINT "artwork_sales_addresses_valid" CHECK ("artwork_sales"."asset_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."buyer_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."seller_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."payment_mint" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."proceeds_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."artist_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND "artwork_sales"."treasury_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "artwork_sales_amounts_valid" CHECK (scale("artwork_sales"."price") = 0 AND scale("artwork_sales"."proceeds_amount") = 0 AND scale("artwork_sales"."royalty_amount") = 0 AND scale("artwork_sales"."platform_fee") = 0 AND "artwork_sales"."price" BETWEEN 1 AND 18446744073709551615 AND "artwork_sales"."proceeds_amount" BETWEEN 0 AND 18446744073709551615 AND "artwork_sales"."royalty_amount" BETWEEN 0 AND 18446744073709551615 AND "artwork_sales"."platform_fee" BETWEEN 0 AND 18446744073709551615 AND "artwork_sales"."price" = "artwork_sales"."proceeds_amount" + "artwork_sales"."royalty_amount" + "artwork_sales"."platform_fee"),
	CONSTRAINT "artwork_sales_recipient_scope" CHECK (("artwork_sales"."is_primary" AND "artwork_sales"."royalty_amount" = 0 AND "artwork_sales"."proceeds_wallet" = "artwork_sales"."artist_wallet") OR (NOT "artwork_sales"."is_primary" AND "artwork_sales"."proceeds_wallet" = "artwork_sales"."seller_wallet"))
);
--> statement-breakpoint
CREATE TABLE "indexed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"program_address" varchar(44) NOT NULL,
	"signature" varchar(88) NOT NULL,
	"slot" bigint NOT NULL,
	"transaction_index" integer NOT NULL,
	"outer_instruction_index" integer NOT NULL,
	"inner_instruction_index" integer DEFAULT -1 NOT NULL,
	"event_index" integer DEFAULT 0 NOT NULL,
	"kind" "indexed_event_kind" NOT NULL,
	"artwork_id" uuid,
	"asset_address" varchar(44),
	"payload" jsonb NOT NULL,
	"chain_recorded_at" timestamp with time zone NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_events_identity_unique" UNIQUE("cluster","signature","outer_instruction_index","inner_instruction_index","event_index"),
	CONSTRAINT "indexed_events_projection_reference_unique" UNIQUE("id","cluster","artwork_id"),
	CONSTRAINT "indexed_events_addresses_valid" CHECK ("indexed_events"."program_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND ("indexed_events"."asset_address" IS NULL OR "indexed_events"."asset_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
	CONSTRAINT "indexed_events_signature_valid" CHECK ("indexed_events"."signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
	CONSTRAINT "indexed_events_position_valid" CHECK ("indexed_events"."slot" >= 0 AND "indexed_events"."transaction_index" >= 0 AND "indexed_events"."outer_instruction_index" >= 0 AND "indexed_events"."inner_instruction_index" >= -1 AND "indexed_events"."event_index" >= 0),
	CONSTRAINT "indexed_events_payload_valid" CHECK (jsonb_typeof("indexed_events"."payload") = 'object' AND octet_length("indexed_events"."payload"::text) <= 65536),
	CONSTRAINT "indexed_events_scope_valid" CHECK ("indexed_events"."kind" = 'REGISTRY' OR ("indexed_events"."artwork_id" IS NOT NULL AND "indexed_events"."asset_address" IS NOT NULL)),
	CONSTRAINT "indexed_events_times_finite" CHECK (isfinite("indexed_events"."chain_recorded_at") AND isfinite("indexed_events"."indexed_at") AND "indexed_events"."indexed_at" >= "indexed_events"."chain_recorded_at")
);
--> statement-breakpoint
CREATE TABLE "indexer_checkpoints" (
	"cluster" "attestation_cluster" NOT NULL,
	"program_address" varchar(44) NOT NULL,
	"from_slot" bigint NOT NULL,
	"scanned_through_slot" bigint,
	"last_signature" varchar(88),
	"last_signature_slot" bigint,
	"gap_from_slot" bigint,
	"gap_through_slot" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_checkpoints_cluster_program_address_pk" PRIMARY KEY("cluster","program_address"),
	CONSTRAINT "indexer_checkpoints_program_valid" CHECK ("indexer_checkpoints"."program_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "indexer_checkpoints_bounds_valid" CHECK ("indexer_checkpoints"."from_slot" >= 0 AND ("indexer_checkpoints"."scanned_through_slot" IS NULL OR "indexer_checkpoints"."scanned_through_slot" >= "indexer_checkpoints"."from_slot") AND (("indexer_checkpoints"."last_signature" IS NULL AND "indexer_checkpoints"."last_signature_slot" IS NULL) OR ("indexer_checkpoints"."last_signature" IS NOT NULL AND "indexer_checkpoints"."last_signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' AND "indexer_checkpoints"."last_signature_slot" IS NOT NULL AND "indexer_checkpoints"."last_signature_slot" >= "indexer_checkpoints"."from_slot" AND "indexer_checkpoints"."scanned_through_slot" IS NOT NULL AND "indexer_checkpoints"."last_signature_slot" <= "indexer_checkpoints"."scanned_through_slot"))),
	CONSTRAINT "indexer_checkpoints_gap_valid" CHECK (("indexer_checkpoints"."gap_from_slot" IS NULL AND "indexer_checkpoints"."gap_through_slot" IS NULL) OR ("indexer_checkpoints"."gap_from_slot" IS NOT NULL AND "indexer_checkpoints"."gap_through_slot" IS NOT NULL AND "indexer_checkpoints"."gap_from_slot" >= "indexer_checkpoints"."from_slot" AND "indexer_checkpoints"."gap_through_slot" >= "indexer_checkpoints"."gap_from_slot")),
	CONSTRAINT "indexer_checkpoints_time_finite" CHECK (isfinite("indexer_checkpoints"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "artwork_listings" ADD CONSTRAINT "artwork_listings_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_listings" ADD CONSTRAINT "artwork_listings_event_fk" FOREIGN KEY ("source_event_id","cluster","artwork_id") REFERENCES "public"."indexed_events"("id","cluster","artwork_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_ownership" ADD CONSTRAINT "artwork_ownership_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_ownership" ADD CONSTRAINT "artwork_ownership_event_fk" FOREIGN KEY ("source_event_id","cluster","artwork_id") REFERENCES "public"."indexed_events"("id","cluster","artwork_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_sales" ADD CONSTRAINT "artwork_sales_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_sales" ADD CONSTRAINT "artwork_sales_event_fk" FOREIGN KEY ("source_event_id","cluster","artwork_id") REFERENCES "public"."indexed_events"("id","cluster","artwork_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_sales" ADD CONSTRAINT "artwork_sales_listing_fk" FOREIGN KEY ("listing_id","cluster","artwork_id") REFERENCES "public"."artwork_listings"("id","cluster","artwork_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "indexed_events" ADD CONSTRAINT "indexed_events_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_listings_active_unique" ON "artwork_listings" USING btree ("cluster","artwork_id") WHERE "artwork_listings"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "artwork_ownership_owner_index" ON "artwork_ownership" USING btree ("cluster","owner_wallet");--> statement-breakpoint
CREATE INDEX "indexed_events_artwork_order_index" ON "indexed_events" USING btree ("artwork_id","cluster","slot","transaction_index","outer_instruction_index","inner_instruction_index","event_index");--> statement-breakpoint
-- Events are retained evidence; query projections may be rebuilt from them.
CREATE FUNCTION public.protect_indexed_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Indexed event identity and contents are immutable'
    USING ERRCODE = '23514', CONSTRAINT = 'indexed_events_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER indexed_events_protect BEFORE UPDATE OR DELETE ON public.indexed_events
FOR EACH ROW EXECUTE FUNCTION public.protect_indexed_event();
--> statement-breakpoint
CREATE FUNCTION public.protect_indexer_checkpoint() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.cluster, NEW.program_address, NEW.from_slot) IS DISTINCT FROM ROW(OLD.cluster, OLD.program_address, OLD.from_slot) THEN
      RAISE EXCEPTION 'Checkpoint stream and start cannot change'
        USING ERRCODE = '23514', CONSTRAINT = 'indexer_checkpoints_identity';
    END IF;
    IF (OLD.scanned_through_slot IS NOT NULL AND (NEW.scanned_through_slot IS NULL OR NEW.scanned_through_slot < OLD.scanned_through_slot))
      OR (OLD.last_signature_slot IS NOT NULL AND (NEW.last_signature_slot IS NULL OR NEW.last_signature_slot < OLD.last_signature_slot)) THEN
      RAISE EXCEPTION 'Checkpoint cannot rewind'
        USING ERRCODE = '23514', CONSTRAINT = 'indexer_checkpoints_monotonic';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER indexer_checkpoints_protect BEFORE INSERT OR UPDATE ON public.indexer_checkpoints
FOR EACH ROW EXECUTE FUNCTION public.protect_indexer_checkpoint();
--> statement-breakpoint
CREATE FUNCTION public.protect_chain_projection() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE source public.indexed_events%ROWTYPE; previous public.indexed_events%ROWTYPE;
  listing public.artwork_listings%ROWTYPE; expected jsonb;
BEGIN
  SELECT * INTO source FROM public.indexed_events WHERE id = NEW.source_event_id;
  IF NOT FOUND OR source.cluster IS DISTINCT FROM NEW.cluster OR source.artwork_id IS DISTINCT FROM NEW.artwork_id
    OR source.asset_address IS DISTINCT FROM NEW.asset_address THEN
    RAISE EXCEPTION 'Projection must match its source event scope'
      USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_event_scope';
  END IF;
  IF TG_TABLE_NAME = 'artwork_ownership' THEN
    IF source.kind NOT IN ('OWNERSHIP', 'SALE') OR NEW.owner_wallet IS DISTINCT FROM
      (CASE WHEN source.kind = 'SALE' THEN source.payload->>'buyerWallet' ELSE source.payload->>'ownerWallet' END) THEN
      RAISE EXCEPTION 'Owner projection must match decoded event'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_owner_binding';
    END IF;
  ELSIF TG_TABLE_NAME = 'artwork_listings' THEN
    expected := jsonb_build_object('listingAddress', NEW.listing_address, 'sellerWallet', NEW.seller_wallet,
      'paymentMint', NEW.payment_mint, 'price', NEW.price::text, 'status', NEW.status::text);
    IF source.kind NOT IN ('LISTING', 'SALE') OR NOT source.payload @> expected
      OR NEW.expires_at IS DISTINCT FROM (source.payload->>'expiresAt')::timestamptz
      OR (source.kind = 'SALE') IS DISTINCT FROM (NEW.status = 'PURCHASED') THEN
      RAISE EXCEPTION 'Listing projection must match decoded event'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_listing_binding';
    END IF;
  ELSE
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Sale projection cannot change; rebuild it from retained events'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_sale_immutable';
    END IF;
    SELECT * INTO listing FROM public.artwork_listings WHERE id = NEW.listing_id;
    IF NOT FOUND OR ROW(listing.cluster, listing.artwork_id, listing.asset_address, listing.seller_wallet, listing.payment_mint, listing.price)
      IS DISTINCT FROM ROW(NEW.cluster, NEW.artwork_id, NEW.asset_address, NEW.seller_wallet, NEW.payment_mint, NEW.price) THEN
      RAISE EXCEPTION 'Sale must match its listing terms'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_sale_listing';
    END IF;
    expected := jsonb_build_object('listingAddress', listing.listing_address, 'buyerWallet', NEW.buyer_wallet,
      'sellerWallet', NEW.seller_wallet, 'paymentMint', NEW.payment_mint, 'price', NEW.price::text,
      'isPrimary', NEW.is_primary, 'proceedsWallet', NEW.proceeds_wallet, 'proceedsAmount', NEW.proceeds_amount::text,
      'artistWallet', NEW.artist_wallet, 'royaltyAmount', NEW.royalty_amount::text,
      'treasuryWallet', NEW.treasury_wallet, 'platformFee', NEW.platform_fee::text);
    IF source.kind <> 'SALE' OR NOT source.payload @> expected THEN
      RAISE EXCEPTION 'Sale projection must match decoded event'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_sale_binding';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
    IF ROW(NEW.cluster, NEW.artwork_id, NEW.asset_address) IS DISTINCT FROM ROW(OLD.cluster, OLD.artwork_id, OLD.asset_address) THEN
      RAISE EXCEPTION 'Projection identity cannot change'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_identity';
    END IF;
    SELECT * INTO previous FROM public.indexed_events WHERE id = OLD.source_event_id;
    IF ROW(source.slot, source.transaction_index, source.outer_instruction_index, source.inner_instruction_index, source.event_index)
      <= ROW(previous.slot, previous.transaction_index, previous.outer_instruction_index, previous.inner_instruction_index, previous.event_index) THEN
      RAISE EXCEPTION 'Projection source must advance in chain order'
        USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_stale_event';
    END IF;
    IF TG_TABLE_NAME = 'artwork_listings' THEN
      IF (to_jsonb(NEW) - ARRAY['status', 'source_event_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'source_event_id'])
        OR OLD.status <> 'ACTIVE' OR NEW.status = 'ACTIVE' THEN
        RAISE EXCEPTION 'Listing terms are immutable and terminal states cannot reopen'
          USING ERRCODE = '23514', CONSTRAINT = 'chain_projections_listing_transition';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artwork_ownership_protect BEFORE INSERT OR UPDATE ON public.artwork_ownership
FOR EACH ROW EXECUTE FUNCTION public.protect_chain_projection();
--> statement-breakpoint
CREATE TRIGGER artwork_listings_protect BEFORE INSERT OR UPDATE ON public.artwork_listings
FOR EACH ROW EXECUTE FUNCTION public.protect_chain_projection();
--> statement-breakpoint
CREATE TRIGGER artwork_sales_protect BEFORE INSERT OR UPDATE ON public.artwork_sales
FOR EACH ROW EXECUTE FUNCTION public.protect_chain_projection();
