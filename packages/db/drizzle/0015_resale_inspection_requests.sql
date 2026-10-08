CREATE TABLE "resale_inspection_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"artwork_id" uuid NOT NULL,
	"owner_wallet" varchar(44) NOT NULL,
	"custody_revision" bigint NOT NULL,
	"condition_version" bigint NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resale_inspection_requests_scope_unique" UNIQUE("artwork_id","owner_wallet","custody_revision","condition_version"),
	CONSTRAINT "resale_inspection_requests_wallet_format" CHECK ("resale_inspection_requests"."owner_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "resale_inspection_requests_condition_valid" CHECK ("resale_inspection_requests"."condition_version" BETWEEN 1 AND 4294967294),
	CONSTRAINT "resale_inspection_requests_revision_valid" CHECK ("resale_inspection_requests"."custody_revision" BETWEEN 1 AND 4294967295)
);
--> statement-breakpoint
ALTER TABLE "resale_inspection_requests" ADD CONSTRAINT "resale_inspection_requests_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE FUNCTION public.protect_resale_inspection_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN
  RAISE EXCEPTION 'Inspection requests are immutable' USING ERRCODE='23514', CONSTRAINT='resale_inspection_requests_immutable';
 END IF;
 IF NEW.requested_at > now() THEN
  RAISE EXCEPTION 'Inspection request time cannot be in the future' USING ERRCODE='23514', CONSTRAINT='resale_inspection_requests_time';
 END IF;
 RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER resale_inspection_requests_protect BEFORE INSERT OR UPDATE OR DELETE
ON public.resale_inspection_requests FOR EACH ROW EXECUTE FUNCTION public.protect_resale_inspection_request();
