ALTER TABLE "artwork_listings" DROP CONSTRAINT "artwork_listings_address_unique";--> statement-breakpoint
ALTER TABLE "artwork_listings" ADD COLUMN "listing_revision" numeric DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "artwork_listings" ADD CONSTRAINT "artwork_listings_revision_unique" UNIQUE("cluster","listing_address","listing_revision");--> statement-breakpoint
ALTER TABLE "artwork_listings" ADD CONSTRAINT "artwork_listings_revision_valid" CHECK (scale("artwork_listings"."listing_revision") = 0 AND "artwork_listings"."listing_revision" BETWEEN 1 AND 18446744073709551615);
--> statement-breakpoint
-- The same on-chain PDA may be relisted. A projection row denotes one immutable
-- creation revision; terminal events advance that revision exactly once.
CREATE FUNCTION public.protect_marketplace_listing_cycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE source public.indexed_events%ROWTYPE; expected_revision numeric;
BEGIN
  SELECT * INTO source FROM public.indexed_events WHERE id = NEW.source_event_id;
  IF source.payload->>'name' IN ('ListingCreated', 'ListingReleased', 'ArtworkPurchased') THEN
    expected_revision := (source.payload->>'revision')::numeric;
    IF NEW.status <> 'ACTIVE' THEN expected_revision := expected_revision - 1; END IF;
    IF NEW.listing_revision IS DISTINCT FROM expected_revision THEN
      RAISE EXCEPTION 'Listing cycle must match its source revision'
        USING ERRCODE = '23514', CONSTRAINT = 'marketplace_listing_cycle_binding';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artwork_listings_cycle_protect BEFORE INSERT OR UPDATE ON public.artwork_listings
FOR EACH ROW EXECUTE FUNCTION public.protect_marketplace_listing_cycle();
