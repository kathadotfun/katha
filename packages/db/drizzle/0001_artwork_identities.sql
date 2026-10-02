CREATE TYPE "public"."artwork_category" AS ENUM('MANDALA', 'PAUBHA', 'THANGKA');--> statement-breakpoint
CREATE TABLE "artwork_id_counters" (
	"category" "artwork_category" PRIMARY KEY NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "artwork_id_counters_range" CHECK ("artwork_id_counters"."last_value" BETWEEN 1 AND 999999)
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"katha_id" varchar(32) DEFAULT '' NOT NULL,
	"artist_id" uuid NOT NULL,
	"category" "artwork_category" NOT NULL,
	"creator_wallet" varchar(44),
	"title" varchar(200) NOT NULL,
	"creation_year" integer NOT NULL,
	"authorship_evidence_hash" varchar(64),
	"height_mm" integer,
	"width_mm" integer,
	"depth_mm" integer,
	"origin_country_code" varchar(2) DEFAULT 'NP' NOT NULL,
	"origin_region" varchar(120),
	"origin_locality" varchar(120),
	"technique" varchar(500),
	"story" varchar(10000),
	"meaning" varchar(5000),
	"cultural_context" varchar(5000),
	"creation_process" varchar(5000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artworks_katha_id_unique" UNIQUE("katha_id"),
	CONSTRAINT "artworks_katha_id_format" CHECK ("artworks"."katha_id" ~ ('^KATHA-' || "artworks"."category"::text || '-[0-9]{6}$') AND right("artworks"."katha_id", 6) <> '000000'),
	CONSTRAINT "artworks_title_nonblank" CHECK ("artworks"."title" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_creation_year_range" CHECK ("artworks"."creation_year" BETWEEN 1 AND 9999),
	CONSTRAINT "artworks_creator_wallet_format" CHECK ("artworks"."creator_wallet" IS NULL OR "artworks"."creator_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "artworks_authorship_hash_format" CHECK ("artworks"."authorship_evidence_hash" IS NULL OR "artworks"."authorship_evidence_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "artworks_dimensions_valid" CHECK (("artworks"."height_mm" IS NULL AND "artworks"."width_mm" IS NULL AND "artworks"."depth_mm" IS NULL) OR ("artworks"."height_mm" IS NOT NULL AND "artworks"."width_mm" IS NOT NULL AND "artworks"."height_mm" > 0 AND "artworks"."width_mm" > 0 AND ("artworks"."depth_mm" IS NULL OR "artworks"."depth_mm" > 0))),
	CONSTRAINT "artworks_country_code_format" CHECK ("artworks"."origin_country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "artworks_origin_region_nonblank" CHECK ("artworks"."origin_region" IS NULL OR "artworks"."origin_region" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_origin_locality_nonblank" CHECK ("artworks"."origin_locality" IS NULL OR "artworks"."origin_locality" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_technique_nonblank" CHECK ("artworks"."technique" IS NULL OR "artworks"."technique" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_story_nonblank" CHECK ("artworks"."story" IS NULL OR "artworks"."story" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_meaning_nonblank" CHECK ("artworks"."meaning" IS NULL OR "artworks"."meaning" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_cultural_context_nonblank" CHECK ("artworks"."cultural_context" IS NULL OR "artworks"."cultural_context" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_creation_process_nonblank" CHECK ("artworks"."creation_process" IS NULL OR "artworks"."creation_process" ~ '[^[:space:]]'),
	CONSTRAINT "artworks_timestamp_order" CHECK ("artworks"."updated_at" >= "artworks"."created_at")
);
--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
-- Drizzle generates the tables/checks above. These triggers enforce cross-row
-- allocation and permanence, which are not represented in its table snapshot.
CREATE FUNCTION public.assign_artwork_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  allocated integer;
  artist_wallet text;
BEGIN
  IF NEW.katha_id <> '' THEN
    RAISE EXCEPTION 'Artwork IDs are allocated by the database'
      USING ERRCODE = '23514', CONSTRAINT = 'artworks_id_database_allocated';
  END IF;
  SELECT creator_wallet INTO artist_wallet FROM public.artists
    WHERE id = NEW.artist_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artwork artist does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'artworks_artist_id_artists_id_fk';
  END IF;
  IF NEW.creator_wallet IS NOT NULL AND NEW.creator_wallet IS DISTINCT FROM artist_wallet THEN
    RAISE EXCEPTION 'Artwork creator wallet must match its artist'
      USING ERRCODE = '23514', CONSTRAINT = 'artworks_creator_attribution';
  END IF;
  NEW.creator_wallet := artist_wallet;
  INSERT INTO public.artwork_id_counters AS counters (category, last_value)
    VALUES (NEW.category, 1)
    ON CONFLICT (category) DO UPDATE SET last_value = counters.last_value + 1
    WHERE counters.last_value < 999999
    RETURNING last_value INTO allocated;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Artwork ID category capacity exhausted'
      USING ERRCODE = '22003', CONSTRAINT = 'artwork_id_counters_range';
  END IF;
  NEW.katha_id := 'KATHA-' || NEW.category::text || '-' || lpad(allocated::text, 6, '0');
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artworks_assign_identity BEFORE INSERT ON public.artworks
FOR EACH ROW EXECUTE FUNCTION public.assign_artwork_identity();
--> statement-breakpoint
CREATE FUNCTION public.protect_artwork_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Permanent artwork records cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'artworks_identity_immutable';
  END IF;
  IF ROW(NEW.id, NEW.katha_id, NEW.artist_id, NEW.category, NEW.creator_wallet,
         NEW.creation_year, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id, OLD.katha_id, OLD.artist_id, OLD.category,
                         OLD.creator_wallet, OLD.creation_year, OLD.created_at)
    OR (OLD.authorship_evidence_hash IS NOT NULL AND
        NEW.authorship_evidence_hash IS DISTINCT FROM OLD.authorship_evidence_hash) THEN
    RAISE EXCEPTION 'Artwork identity and committed attribution are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'artworks_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artworks_protect_identity BEFORE UPDATE OR DELETE ON public.artworks
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_identity();
--> statement-breakpoint
CREATE FUNCTION public.protect_artwork_counter() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Artwork ID counters cannot be deleted'
      USING ERRCODE = '23514', CONSTRAINT = 'artwork_id_counters_monotonic';
  END IF;
  IF NEW.category IS DISTINCT FROM OLD.category OR NEW.last_value < OLD.last_value THEN
    RAISE EXCEPTION 'Artwork ID counters cannot be reset'
      USING ERRCODE = '23514', CONSTRAINT = 'artwork_id_counters_monotonic';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artwork_id_counters_protect BEFORE UPDATE OR DELETE ON public.artwork_id_counters
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_counter();
