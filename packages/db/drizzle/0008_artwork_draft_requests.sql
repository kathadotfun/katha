ALTER TABLE "artworks" ADD COLUMN "creation_request_id" uuid;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_creation_request_unique" UNIQUE("creation_request_id");--> statement-breakpoint
CREATE FUNCTION public.protect_artwork_creation_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.creation_request_id IS DISTINCT FROM OLD.creation_request_id THEN
    RAISE EXCEPTION 'Artwork creation request identity is immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'artworks_creation_request_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER artworks_protect_creation_request BEFORE UPDATE ON public.artworks
FOR EACH ROW EXECUTE FUNCTION public.protect_artwork_creation_request();
