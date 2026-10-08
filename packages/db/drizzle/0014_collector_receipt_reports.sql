CREATE TABLE "fulfillment_receipt_reports" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"reporter_wallet" varchar(44) NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fulfillment_receipt_reports_wallet_format" CHECK ("fulfillment_receipt_reports"."reporter_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
ALTER TABLE "fulfillment_receipt_reports" ADD CONSTRAINT "fulfillment_receipt_reports_request_id_fulfillment_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."fulfillment_requests"("id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE FUNCTION public.protect_fulfillment_receipt_report() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request public.fulfillment_requests%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Collector receipt reports are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_receipt_reports_immutable';
  END IF;
  SELECT * INTO request FROM public.fulfillment_requests WHERE id = NEW.request_id FOR SHARE;
  IF NOT FOUND OR request.kind <> 'DELIVERY' OR request.status <> 'DISPATCHED'
     OR request.requester_wallet <> NEW.reporter_wallet OR NEW.reported_at > now()
     OR NEW.reported_at < request.created_at THEN
    RAISE EXCEPTION 'Receipt report does not match a dispatched delivery requester'
      USING ERRCODE = '23514', CONSTRAINT = 'fulfillment_receipt_reports_request';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER fulfillment_receipt_reports_protect BEFORE INSERT OR UPDATE OR DELETE
ON public.fulfillment_receipt_reports FOR EACH ROW EXECUTE FUNCTION public.protect_fulfillment_receipt_report();
