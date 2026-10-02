CREATE TYPE "public"."artwork_media_kind" AS ENUM('IMAGE', 'VIDEO', 'DOCUMENT');--> statement-breakpoint
CREATE TYPE "public"."artwork_media_role" AS ENUM('HERO', 'FRONT', 'BACK', 'DETAIL', 'ARTIST', 'PROCESS', 'CERTIFICATE', 'CONDITION', 'DOCUMENTARY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."media_visibility" AS ENUM('PRIVATE', 'PUBLIC');--> statement-breakpoint
CREATE TABLE "artwork_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "artwork_materials_position_unique" UNIQUE("artwork_id","position"),
	CONSTRAINT "artwork_materials_position_valid" CHECK ("artwork_materials"."position" >= 0),
	CONSTRAINT "artwork_materials_name_valid" CHECK ("artwork_materials"."name" ~ '[^[:space:]]' AND "artwork_materials"."name" = btrim("artwork_materials"."name") AND position(',' in "artwork_materials"."name") = 0)
);
--> statement-breakpoint
CREATE TABLE "artwork_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"artwork_id" uuid NOT NULL,
	"kind" "artwork_media_kind" NOT NULL,
	"role" "artwork_media_role" DEFAULT 'OTHER' NOT NULL,
	"visibility" "media_visibility" DEFAULT 'PRIVATE' NOT NULL,
	"position" integer NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"byte_size" bigint NOT NULL,
	"alt_text" varchar(500),
	"caption" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artwork_media_position_unique" UNIQUE("artwork_id","position"),
	CONSTRAINT "artwork_media_position_valid" CHECK ("artwork_media"."position" >= 0),
	CONSTRAINT "artwork_media_hash_format" CHECK ("artwork_media"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "artwork_media_size_positive" CHECK ("artwork_media"."byte_size" > 0),
	CONSTRAINT "artwork_media_storage_key_valid" CHECK ("artwork_media"."storage_key" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' AND "artwork_media"."storage_key" !~ '(^|/)\.\.?(/|$)' AND "artwork_media"."storage_key" !~ '//|/$'),
	CONSTRAINT "artwork_media_mime_kind_valid" CHECK (("artwork_media"."kind" = 'IMAGE' AND "artwork_media"."mime_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')) OR ("artwork_media"."kind" = 'VIDEO' AND "artwork_media"."mime_type" IN ('video/mp4', 'video/webm')) OR ("artwork_media"."kind" = 'DOCUMENT' AND "artwork_media"."mime_type" = 'application/pdf')),
	CONSTRAINT "artwork_media_hero_image" CHECK ("artwork_media"."role" <> 'HERO' OR "artwork_media"."kind" = 'IMAGE'),
	CONSTRAINT "artwork_media_alt_text_valid" CHECK (("artwork_media"."alt_text" IS NULL OR "artwork_media"."alt_text" ~ '[^[:space:]]') AND ("artwork_media"."visibility" <> 'PUBLIC' OR "artwork_media"."kind" <> 'IMAGE' OR "artwork_media"."alt_text" IS NOT NULL)),
	CONSTRAINT "artwork_media_caption_nonblank" CHECK ("artwork_media"."caption" IS NULL OR "artwork_media"."caption" ~ '[^[:space:]]'),
	CONSTRAINT "artwork_media_timestamp_order" CHECK ("artwork_media"."updated_at" >= "artwork_media"."created_at")
);
--> statement-breakpoint
ALTER TABLE "artwork_materials" ADD CONSTRAINT "artwork_materials_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "artwork_media" ADD CONSTRAINT "artwork_media_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_materials_name_unique" ON "artwork_materials" USING btree ("artwork_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "artwork_media_hero_unique" ON "artwork_media" USING btree ("artwork_id") WHERE "artwork_media"."role" = 'HERO';