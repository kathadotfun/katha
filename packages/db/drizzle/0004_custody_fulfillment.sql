CREATE TYPE "public"."fulfillment_kind" AS ENUM('DELIVERY', 'RETURN_TO_KATHA');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('REQUESTED', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."physical_custody_state" AS ENUM('UNKNOWN', 'KATHA_HELD', 'COLLECTOR_HELD', 'IN_TRANSIT');--> statement-breakpoint
CREATE TABLE "custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"from_state" "physical_custody_state" NOT NULL,
	"to_state" "physical_custody_state" NOT NULL,
	"custodian_wallet" varchar(44) NOT NULL,
	"recorded_by_wallet" varchar(44) NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custody_events_artwork_revision_unique" UNIQUE("artwork_id","revision"),
	CONSTRAINT "custody_events_revision_valid" CHECK ("custody_events"."revision" BETWEEN 1 AND 4294967295),
	CONSTRAINT "custody_events_transition_valid" CHECK (
    ("custody_events"."from_state" = 'UNKNOWN' AND "custody_events"."to_state" IN ('KATHA_HELD', 'COLLECTOR_HELD')) OR
    ("custody_events"."from_state" IN ('KATHA_HELD', 'COLLECTOR_HELD') AND "custody_events"."to_state" = 'IN_TRANSIT') OR
    ("custody_events"."from_state" = 'IN_TRANSIT' AND "custody_events"."to_state" IN ('KATHA_HELD', 'COLLECTOR_HELD'))),
	CONSTRAINT "custody_events_custodian_format" CHECK ("custody_events"."custodian_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "custody_events_recorder_format" CHECK ("custody_events"."recorded_by_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "custody_events_evidence_hash_format" CHECK ("custody_events"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "custody_events_time_order" CHECK ("custody_events"."occurred_at" <= "custody_events"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "fulfillment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"requester_wallet" varchar(44) NOT NULL,
	"kind" "fulfillment_kind" NOT NULL,
	"status" "fulfillment_status" DEFAULT 'REQUESTED' NOT NULL,
	"recipient_name" varchar(200) NOT NULL,
	"contact_email" varchar(254),
	"contact_phone" varchar(40),
	"address_lines" varchar(200)[] NOT NULL,
	"city" varchar(120) NOT NULL,
	"region" varchar(120),
	"postal_code" varchar(32),
	"country_code" varchar(2) NOT NULL,
	"delivery_instructions" varchar(2000),
	"courier" varchar(120),
	"tracking_reference" varchar(200),
	"handled_by_wallet" varchar(44),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_requests_requester_format" CHECK ("fulfillment_requests"."requester_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "fulfillment_requests_handler_valid" CHECK (("fulfillment_requests"."handled_by_wallet" IS NULL AND "fulfillment_requests"."status" IN ('REQUESTED', 'CANCELLED')) OR ("fulfillment_requests"."handled_by_wallet" IS NOT NULL AND "fulfillment_requests"."handled_by_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')),
	CONSTRAINT "fulfillment_requests_recipient_nonblank" CHECK ("fulfillment_requests"."recipient_name" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_contact_valid" CHECK (
    ("fulfillment_requests"."contact_email" IS NOT NULL OR "fulfillment_requests"."contact_phone" IS NOT NULL)
    AND ("fulfillment_requests"."contact_email" IS NULL OR "fulfillment_requests"."contact_email" ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    AND ("fulfillment_requests"."contact_phone" IS NULL OR "fulfillment_requests"."contact_phone" ~ '^[+0-9][0-9 ()-]{4,39}$')),
	CONSTRAINT "fulfillment_requests_address_valid" CHECK (
    cardinality("fulfillment_requests"."address_lines") BETWEEN 1 AND 5 AND array_ndims("fulfillment_requests"."address_lines") = 1
    AND array_position("fulfillment_requests"."address_lines", NULL) IS NULL
    AND array_to_string("fulfillment_requests"."address_lines", chr(31)) !~ ('(^|' || chr(31) || ')[[:space:]]*(' || chr(31) || '|$)')),
	CONSTRAINT "fulfillment_requests_city_nonblank" CHECK ("fulfillment_requests"."city" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_country_format" CHECK ("fulfillment_requests"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "fulfillment_requests_region_nonblank" CHECK ("fulfillment_requests"."region" IS NULL OR "fulfillment_requests"."region" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_postal_nonblank" CHECK ("fulfillment_requests"."postal_code" IS NULL OR "fulfillment_requests"."postal_code" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_instructions_nonblank" CHECK ("fulfillment_requests"."delivery_instructions" IS NULL OR "fulfillment_requests"."delivery_instructions" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_courier_nonblank" CHECK ("fulfillment_requests"."courier" IS NULL OR "fulfillment_requests"."courier" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_tracking_nonblank" CHECK ("fulfillment_requests"."tracking_reference" IS NULL OR "fulfillment_requests"."tracking_reference" ~ '[^[:space:]]'),
	CONSTRAINT "fulfillment_requests_timestamp_order" CHECK ("fulfillment_requests"."updated_at" >= "fulfillment_requests"."created_at")
);
--> statement-breakpoint
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "fulfillment_requests" ADD CONSTRAINT "fulfillment_requests_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "fulfillment_requests_requester_index" ON "fulfillment_requests" USING btree ("requester_wallet");--> statement-breakpoint
CREATE INDEX "fulfillment_requests_artwork_index" ON "fulfillment_requests" USING btree ("artwork_id");
--> statement-breakpoint
-- Reviewed custom guards; Drizzle snapshots describe tables, not these triggers.
CREATE FUNCTION public.record_manual_custody() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  last_event public.custody_events%ROWTYPE;
  expected_state public.physical_custody_state;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Manual custody history is append-only'
      USING ERRCODE = '23514', CONSTRAINT = 'custody_events_immutable';
  END IF;
  IF NEW.revision <> 0 THEN
    RAISE EXCEPTION 'Custody revisions are allocated by the database'
      USING ERRCODE = '23514', CONSTRAINT = 'custody_events_revision_allocated';
  END IF;
  PERFORM id FROM public.artworks WHERE id = NEW.artwork_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Custody artwork does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'custody_events_artwork_id_artworks_id_fk';
  END IF;
  SELECT * INTO last_event FROM public.custody_events WHERE artwork_id = NEW.artwork_id
    ORDER BY revision DESC LIMIT 1;
  expected_state := coalesce(last_event.to_state, 'UNKNOWN');
  IF NEW.from_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'Custody observation uses a stale previous state'
      USING ERRCODE = '23514', CONSTRAINT = 'custody_events_previous_state';
  END IF;
  IF last_event.occurred_at IS NOT NULL AND NEW.occurred_at < last_event.occurred_at THEN
    RAISE EXCEPTION 'Custody observation predates its previous event'
      USING ERRCODE = '23514', CONSTRAINT = 'custody_events_history_order';
  END IF;
  NEW.revision := coalesce(last_event.revision, 0) + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER custody_events_record BEFORE INSERT OR UPDATE OR DELETE ON public.custody_events
FOR EACH ROW EXECUTE FUNCTION public.record_manual_custody();
--> statement-breakpoint
CREATE FUNCTION public.protect_fulfillment_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'REQUESTED' THEN
      RAISE EXCEPTION 'Fulfillment starts with a request'
        USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_requests_transition';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED', 'DISPATCHED') THEN
      RAISE EXCEPTION 'Active fulfillment cannot be deleted'
        USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_requests_active';
    END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.id, NEW.artwork_id, NEW.requester_wallet, NEW.kind, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.artwork_id, OLD.requester_wallet, OLD.kind, OLD.created_at) THEN
    RAISE EXCEPTION 'Fulfillment identity cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_requests_identity';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'REQUESTED' AND NEW.status IN ('APPROVED', 'CANCELLED')) OR
    (OLD.status = 'APPROVED' AND NEW.status IN ('DISPATCHED', 'CANCELLED')) OR
    (OLD.status = 'DISPATCHED' AND NEW.status = 'RECEIVED')) THEN
    RAISE EXCEPTION 'Invalid fulfillment transition'
      USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_requests_transition';
  END IF;
  IF OLD.status IN ('DISPATCHED', 'RECEIVED', 'CANCELLED') AND
     (to_jsonb(NEW) - ARRAY['status','handled_by_wallet','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['status','handled_by_wallet','updated_at']) THEN
    RAISE EXCEPTION 'Dispatched or closed fulfillment details cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_requests_details_locked';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_requests_protect BEFORE INSERT OR UPDATE OR DELETE ON public.fulfillment_requests
FOR EACH ROW EXECUTE FUNCTION public.protect_fulfillment_request();
