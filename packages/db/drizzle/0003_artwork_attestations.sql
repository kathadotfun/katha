CREATE TYPE "public"."attestation_cluster" AS ENUM('LOCALNET', 'DEVNET');--> statement-breakpoint
CREATE TYPE "public"."attestation_status" AS ENUM('DRAFT', 'PREPARED', 'FINALIZED');--> statement-breakpoint
CREATE TYPE "public"."condition_grade" AS ENUM('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'DAMAGED');--> statement-breakpoint
CREATE TYPE "public"."condition_reason" AS ENUM('INITIAL_VERIFICATION', 'PRE_SALE', 'POST_DELIVERY', 'PRE_RESALE', 'RETURN_TO_CUSTODY', 'INSURANCE');--> statement-breakpoint
CREATE TABLE "artwork_metadata_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"status" "attestation_status" DEFAULT 'DRAFT' NOT NULL,
	"authority_wallet" varchar(44) NOT NULL,
	"canonical_document" text,
	"document_hash" varchar(64),
	"chain_cluster" "attestation_cluster",
	"chain_signature" varchar(88),
	"chain_slot" bigint,
	"chain_recorded_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint NOT NULL,
	"chain_version" bigint,
	"uri" varchar(200),
	CONSTRAINT "metadata_versions_artwork_version_unique" UNIQUE("artwork_id","version"),
	CONSTRAINT "metadata_versions_authority_format" CHECK ("artwork_metadata_versions"."authority_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "metadata_versions_document_integrity" CHECK (
      ("artwork_metadata_versions"."canonical_document" IS NULL AND "artwork_metadata_versions"."document_hash" IS NULL AND "artwork_metadata_versions"."status" = 'DRAFT') OR
      ("artwork_metadata_versions"."canonical_document" IS NOT NULL AND "artwork_metadata_versions"."document_hash" IS NOT NULL
       AND octet_length(convert_to("artwork_metadata_versions"."canonical_document", 'UTF8')) BETWEEN 2 AND 1048576
       AND jsonb_typeof("artwork_metadata_versions"."canonical_document"::jsonb) = 'object'
       AND "artwork_metadata_versions"."document_hash" ~ '^[0-9a-f]{64}$'
       AND "artwork_metadata_versions"."document_hash" = encode(sha256(convert_to("artwork_metadata_versions"."canonical_document", 'UTF8')), 'hex'))),
	CONSTRAINT "metadata_versions_receipt_complete" CHECK (
      ("artwork_metadata_versions"."status" <> 'FINALIZED' AND "artwork_metadata_versions"."chain_cluster" IS NULL AND "artwork_metadata_versions"."chain_signature" IS NULL AND "artwork_metadata_versions"."chain_slot" IS NULL
       AND "artwork_metadata_versions"."chain_recorded_at" IS NULL AND "artwork_metadata_versions"."finalized_at" IS NULL) OR
      ("artwork_metadata_versions"."status" = 'FINALIZED' AND "artwork_metadata_versions"."chain_cluster" IS NOT NULL AND "artwork_metadata_versions"."chain_signature" IS NOT NULL AND "artwork_metadata_versions"."chain_slot" IS NOT NULL
       AND "artwork_metadata_versions"."chain_recorded_at" IS NOT NULL AND "artwork_metadata_versions"."finalized_at" IS NOT NULL
       AND "artwork_metadata_versions"."chain_signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       AND "artwork_metadata_versions"."chain_slot" >= 0 AND "artwork_metadata_versions"."finalized_at" >= "artwork_metadata_versions"."chain_recorded_at")),
	CONSTRAINT "metadata_versions_timestamp_order" CHECK ("artwork_metadata_versions"."updated_at" >= "artwork_metadata_versions"."created_at" AND ("artwork_metadata_versions"."finalized_at" IS NULL OR "artwork_metadata_versions"."finalized_at" <= "artwork_metadata_versions"."updated_at")),
	CONSTRAINT "metadata_versions_chain_version_valid" CHECK (("artwork_metadata_versions"."status" <> 'FINALIZED' AND "artwork_metadata_versions"."chain_version" IS NULL) OR ("artwork_metadata_versions"."status" = 'FINALIZED' AND "artwork_metadata_versions"."chain_version" IS NOT NULL AND "artwork_metadata_versions"."chain_version" BETWEEN 1 AND 4294967295)),
	CONSTRAINT "metadata_versions_version_valid" CHECK ("artwork_metadata_versions"."version" BETWEEN 1 AND 4294967295),
	CONSTRAINT "metadata_versions_uri_valid" CHECK (
      ("artwork_metadata_versions"."uri" IS NULL AND "artwork_metadata_versions"."status" = 'DRAFT') OR
      ("artwork_metadata_versions"."uri" IS NOT NULL AND "artwork_metadata_versions"."uri" ~ '^https?://[^[:space:]@/#?]+([/?][^[:space:]#]*)?$'
       AND octet_length("artwork_metadata_versions"."uri") <= 200 AND "artwork_metadata_versions"."uri" !~ '[^ -~]'))
);
--> statement-breakpoint
CREATE TABLE "condition_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"status" "attestation_status" DEFAULT 'DRAFT' NOT NULL,
	"authority_wallet" varchar(44) NOT NULL,
	"canonical_document" text,
	"document_hash" varchar(64),
	"chain_cluster" "attestation_cluster",
	"chain_signature" varchar(88),
	"chain_slot" bigint,
	"chain_recorded_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint NOT NULL,
	"chain_version" bigint,
	"inspector_id" uuid NOT NULL,
	"grade" "condition_grade" NOT NULL,
	"reason" "condition_reason" NOT NULL,
	"inspected_at" timestamp with time zone NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"notes" varchar(5000) NOT NULL,
	"media_hashes" varchar(64)[] NOT NULL,
	"owner_wallet" varchar(44),
	"custody_revision" bigint,
	CONSTRAINT "condition_reports_artwork_version_unique" UNIQUE("artwork_id","version"),
	CONSTRAINT "condition_reports_authority_format" CHECK ("condition_reports"."authority_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "condition_reports_document_integrity" CHECK (
      ("condition_reports"."canonical_document" IS NULL AND "condition_reports"."document_hash" IS NULL AND "condition_reports"."status" = 'DRAFT') OR
      ("condition_reports"."canonical_document" IS NOT NULL AND "condition_reports"."document_hash" IS NOT NULL
       AND octet_length(convert_to("condition_reports"."canonical_document", 'UTF8')) BETWEEN 2 AND 1048576
       AND jsonb_typeof("condition_reports"."canonical_document"::jsonb) = 'object'
       AND "condition_reports"."document_hash" ~ '^[0-9a-f]{64}$'
       AND "condition_reports"."document_hash" = encode(sha256(convert_to("condition_reports"."canonical_document", 'UTF8')), 'hex'))),
	CONSTRAINT "condition_reports_receipt_complete" CHECK (
      ("condition_reports"."status" <> 'FINALIZED' AND "condition_reports"."chain_cluster" IS NULL AND "condition_reports"."chain_signature" IS NULL AND "condition_reports"."chain_slot" IS NULL
       AND "condition_reports"."chain_recorded_at" IS NULL AND "condition_reports"."finalized_at" IS NULL) OR
      ("condition_reports"."status" = 'FINALIZED' AND "condition_reports"."chain_cluster" IS NOT NULL AND "condition_reports"."chain_signature" IS NOT NULL AND "condition_reports"."chain_slot" IS NOT NULL
       AND "condition_reports"."chain_recorded_at" IS NOT NULL AND "condition_reports"."finalized_at" IS NOT NULL
       AND "condition_reports"."chain_signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       AND "condition_reports"."chain_slot" >= 0 AND "condition_reports"."finalized_at" >= "condition_reports"."chain_recorded_at")),
	CONSTRAINT "condition_reports_timestamp_order" CHECK ("condition_reports"."updated_at" >= "condition_reports"."created_at" AND ("condition_reports"."finalized_at" IS NULL OR "condition_reports"."finalized_at" <= "condition_reports"."updated_at")),
	CONSTRAINT "condition_reports_chain_version_valid" CHECK (("condition_reports"."status" <> 'FINALIZED' AND "condition_reports"."chain_version" IS NULL) OR ("condition_reports"."status" = 'FINALIZED' AND "condition_reports"."chain_version" IS NOT NULL AND "condition_reports"."chain_version" BETWEEN 1 AND 4294967295)),
	CONSTRAINT "condition_reports_version_valid" CHECK ("condition_reports"."version" BETWEEN 1 AND 4294967295),
	CONSTRAINT "condition_reports_notes_nonblank" CHECK ("condition_reports"."notes" ~ '[^[:space:]]'),
	CONSTRAINT "condition_reports_media_hashes_valid" CHECK (
      cardinality("condition_reports"."media_hashes") BETWEEN 1 AND 20 AND array_ndims("condition_reports"."media_hashes") = 1
      AND array_position("condition_reports"."media_hashes", NULL) IS NULL
      AND array_to_string("condition_reports"."media_hashes", ',') ~ '^[0-9a-f]{64}(,[0-9a-f]{64})*$'),
	CONSTRAINT "condition_reports_inspection_order" CHECK ("condition_reports"."reported_at" >= "condition_reports"."inspected_at" AND "condition_reports"."updated_at" >= "condition_reports"."reported_at" AND ("condition_reports"."chain_recorded_at" IS NULL OR "condition_reports"."chain_recorded_at" >= "condition_reports"."inspected_at")),
	CONSTRAINT "condition_reports_owner_scope_valid" CHECK (
      ("condition_reports"."owner_wallet" IS NULL AND "condition_reports"."custody_revision" IS NULL) OR
      ("condition_reports"."owner_wallet" IS NOT NULL AND "condition_reports"."custody_revision" IS NOT NULL
       AND "condition_reports"."owner_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
       AND "condition_reports"."custody_revision" BETWEEN 1 AND 4294967295))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"status" "attestation_status" DEFAULT 'DRAFT' NOT NULL,
	"authority_wallet" varchar(44) NOT NULL,
	"canonical_document" text,
	"document_hash" varchar(64),
	"chain_cluster" "attestation_cluster",
	"chain_signature" varchar(88),
	"chain_slot" bigint,
	"chain_recorded_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inspected_at" timestamp with time zone NOT NULL,
	"evidence_hash" varchar(64) NOT NULL,
	"notes" varchar(5000),
	CONSTRAINT "verifications_authority_format" CHECK ("verifications"."authority_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "verifications_document_integrity" CHECK (
      ("verifications"."canonical_document" IS NULL AND "verifications"."document_hash" IS NULL AND "verifications"."status" = 'DRAFT') OR
      ("verifications"."canonical_document" IS NOT NULL AND "verifications"."document_hash" IS NOT NULL
       AND octet_length(convert_to("verifications"."canonical_document", 'UTF8')) BETWEEN 2 AND 1048576
       AND jsonb_typeof("verifications"."canonical_document"::jsonb) = 'object'
       AND "verifications"."document_hash" ~ '^[0-9a-f]{64}$'
       AND "verifications"."document_hash" = encode(sha256(convert_to("verifications"."canonical_document", 'UTF8')), 'hex'))),
	CONSTRAINT "verifications_receipt_complete" CHECK (
      ("verifications"."status" <> 'FINALIZED' AND "verifications"."chain_cluster" IS NULL AND "verifications"."chain_signature" IS NULL AND "verifications"."chain_slot" IS NULL
       AND "verifications"."chain_recorded_at" IS NULL AND "verifications"."finalized_at" IS NULL) OR
      ("verifications"."status" = 'FINALIZED' AND "verifications"."chain_cluster" IS NOT NULL AND "verifications"."chain_signature" IS NOT NULL AND "verifications"."chain_slot" IS NOT NULL
       AND "verifications"."chain_recorded_at" IS NOT NULL AND "verifications"."finalized_at" IS NOT NULL
       AND "verifications"."chain_signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'
       AND "verifications"."chain_slot" >= 0 AND "verifications"."finalized_at" >= "verifications"."chain_recorded_at")),
	CONSTRAINT "verifications_timestamp_order" CHECK ("verifications"."updated_at" >= "verifications"."created_at" AND ("verifications"."finalized_at" IS NULL OR "verifications"."finalized_at" <= "verifications"."updated_at")),
	CONSTRAINT "verifications_evidence_hash_format" CHECK ("verifications"."evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "verifications_notes_nonblank" CHECK ("verifications"."notes" IS NULL OR "verifications"."notes" ~ '[^[:space:]]'),
	CONSTRAINT "verifications_inspection_order" CHECK ("verifications"."inspected_at" <= "verifications"."updated_at" AND ("verifications"."chain_recorded_at" IS NULL OR "verifications"."inspected_at" <= "verifications"."chain_recorded_at"))
);
--> statement-breakpoint
ALTER TABLE "artwork_metadata_versions" ADD CONSTRAINT "artwork_metadata_versions_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "metadata_versions_chain_version_unique" ON "artwork_metadata_versions" USING btree ("artwork_id","chain_cluster","chain_version") WHERE "artwork_metadata_versions"."status" = 'FINALIZED';--> statement-breakpoint
CREATE UNIQUE INDEX "condition_reports_chain_version_unique" ON "condition_reports" USING btree ("artwork_id","chain_cluster","chain_version") WHERE "condition_reports"."status" = 'FINALIZED';--> statement-breakpoint
CREATE UNIQUE INDEX "verifications_finalized_artwork_unique" ON "verifications" USING btree ("artwork_id") WHERE "verifications"."status" = 'FINALIZED';
--> statement-breakpoint
-- Custom lifecycle guards are not represented by Drizzle table snapshots.
CREATE FUNCTION public.protect_artwork_attestation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  old_record jsonb;
  new_record jsonb;
  document jsonb;
  artwork_public_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Prepared artwork documents cannot be deleted'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_immutable';
    END IF;
    RETURN OLD;
  END IF;
  new_record := to_jsonb(NEW);
  IF TG_OP = 'INSERT' AND NEW.status = 'FINALIZED' THEN
    RAISE EXCEPTION 'Attestations must be prepared before finalization'
      USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_transition';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    old_record := to_jsonb(OLD);
    IF ROW(NEW.id, NEW.artwork_id, NEW.created_at) IS DISTINCT FROM
       ROW(OLD.id, OLD.artwork_id, OLD.created_at)
       OR new_record->'version' IS DISTINCT FROM old_record->'version' THEN
      RAISE EXCEPTION 'Attestation identity cannot change'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_identity';
    END IF;
    IF OLD.status = 'FINALIZED' THEN
      RAISE EXCEPTION 'Finalized attestations cannot change'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_immutable';
    END IF;
    IF OLD.status = 'DRAFT' AND NEW.status = 'FINALIZED' THEN
      RAISE EXCEPTION 'Drafts must be prepared before finalization'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_transition';
    END IF;
    IF OLD.status = 'PREPARED' AND
       (NEW.status = 'DRAFT' OR
        (new_record - ARRAY['status','chain_version','chain_cluster','chain_signature','chain_slot','chain_recorded_at','finalized_at','updated_at'])
        IS DISTINCT FROM
        (old_record - ARRAY['status','chain_version','chain_cluster','chain_signature','chain_slot','chain_recorded_at','finalized_at','updated_at'])) THEN
      RAISE EXCEPTION 'Prepared artwork documents cannot change'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_immutable';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'condition_reports' THEN
    IF cardinality(NEW.media_hashes) <> (SELECT count(DISTINCT hash) FROM unnest(NEW.media_hashes) AS hashes(hash)) THEN
      RAISE EXCEPTION 'Condition media hashes must be distinct'
        USING ERRCODE = '23514', CONSTRAINT = 'condition_reports_media_hashes_unique';
    END IF;
  END IF;
  IF NEW.status <> 'DRAFT' THEN
    SELECT katha_id INTO artwork_public_id FROM public.artworks WHERE id = NEW.artwork_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Attestation artwork does not exist'
        USING ERRCODE = '23503', CONSTRAINT = 'artwork_attestation_artwork_fk';
    END IF;
    document := NEW.canonical_document::jsonb;
    IF document->>'kathaId' IS DISTINCT FROM artwork_public_id THEN
      RAISE EXCEPTION 'Document must reference its artwork'
        USING ERRCODE = '23514', CONSTRAINT = 'artwork_attestation_document_identity';
    END IF;
    IF TG_TABLE_NAME = 'condition_reports' THEN
      IF document->>'reportId' IS DISTINCT FROM NEW.id::text
         OR document->>'grade' IS DISTINCT FROM NEW.grade::text
         OR document->>'reason' IS DISTINCT FROM NEW.reason::text
         OR document->>'inspectorId' IS DISTINCT FROM NEW.inspector_id::text
         OR document->>'verifierWallet' IS DISTINCT FROM NEW.authority_wallet
         OR document->>'notes' IS DISTINCT FROM NEW.notes
         OR document->'mediaHashes' IS DISTINCT FROM to_jsonb(NEW.media_hashes)
         OR document->>'inspectedAt' IS DISTINCT FROM to_char(NEW.inspected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         OR document->>'reportedAt' IS DISTINCT FROM to_char(NEW.reported_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
        RAISE EXCEPTION 'Condition document must match its report fields'
          USING ERRCODE = '23514', CONSTRAINT = 'condition_reports_document_fields';
      END IF;
    ELSIF TG_TABLE_NAME = 'verifications' THEN
      IF document->>'evidenceHash' IS DISTINCT FROM NEW.evidence_hash
         OR document->>'verifierWallet' IS DISTINCT FROM NEW.authority_wallet
         OR document->>'notes' IS DISTINCT FROM NEW.notes
         OR document->>'inspectedAt' IS DISTINCT FROM to_char(NEW.inspected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') THEN
        RAISE EXCEPTION 'Verification document must match its evidence and verifier'
          USING ERRCODE = '23514', CONSTRAINT = 'verifications_document_fields';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER metadata_versions_protect BEFORE INSERT OR UPDATE OR DELETE ON public.artwork_metadata_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_attestation();
--> statement-breakpoint
CREATE TRIGGER verifications_protect BEFORE INSERT OR UPDATE OR DELETE ON public.verifications
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_attestation();
--> statement-breakpoint
CREATE TRIGGER condition_reports_protect BEFORE INSERT OR UPDATE OR DELETE ON public.condition_reports
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_attestation();
