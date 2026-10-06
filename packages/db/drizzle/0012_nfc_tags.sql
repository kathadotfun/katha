CREATE TABLE "nfc_tags" (
	"tag_id" uuid PRIMARY KEY NOT NULL,
	"artwork_id" uuid NOT NULL,
	"assigned_by_wallet_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by_wallet_id" uuid,
	CONSTRAINT "nfc_tags_retirement" CHECK (("nfc_tags"."retired_at" IS NULL AND "nfc_tags"."retired_by_wallet_id" IS NULL) OR ("nfc_tags"."retired_at" IS NOT NULL AND "nfc_tags"."retired_at" >= "nfc_tags"."assigned_at" AND "nfc_tags"."retired_by_wallet_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "nfc_tags" ADD CONSTRAINT "nfc_tags_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "nfc_tags" ADD CONSTRAINT "nfc_tags_assigned_by_wallet_id_wallets_id_fk" FOREIGN KEY ("assigned_by_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "nfc_tags" ADD CONSTRAINT "nfc_tags_retired_by_wallet_id_wallets_id_fk" FOREIGN KEY ("retired_by_wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "nfc_tags_one_active_artwork" ON "nfc_tags" USING btree ("artwork_id") WHERE "nfc_tags"."retired_at" IS NULL;
--> statement-breakpoint
-- Reserve every public identifier permanently, including retired tags.
CREATE FUNCTION public.katha_guard_nfc_tag() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'NFC tag history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL OR NEW.retired_by_wallet_id IS NOT NULL THEN
      RAISE EXCEPTION 'NFC tags must start active' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tag_id IS DISTINCT FROM OLD.tag_id
    OR NEW.artwork_id IS DISTINCT FROM OLD.artwork_id
    OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
    OR NEW.assigned_by_wallet_id IS DISTINCT FROM OLD.assigned_by_wallet_id
    OR OLD.retired_at IS NOT NULL
    OR NEW.retired_at IS NULL
    OR NEW.retired_by_wallet_id IS NULL THEN
    RAISE EXCEPTION 'NFC assignment is immutable; retirement is terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER nfc_tags_immutable BEFORE INSERT OR UPDATE OR DELETE ON nfc_tags
FOR EACH ROW EXECUTE FUNCTION public.katha_guard_nfc_tag();
