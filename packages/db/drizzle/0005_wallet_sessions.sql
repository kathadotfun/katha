CREATE TABLE "wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"nonce" varchar(64) NOT NULL,
	"domain" varchar(253) NOT NULL,
	"cluster" "attestation_cluster" NOT NULL,
	"message" text NOT NULL,
	"message_hash" varchar(64) NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "wallet_challenges_nonce_unique" UNIQUE("nonce"),
	CONSTRAINT "wallet_challenges_id_wallet_unique" UNIQUE("id","wallet_id"),
	CONSTRAINT "wallet_challenges_nonce_format" CHECK ("wallet_challenges"."nonce" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wallet_challenges_domain_format" CHECK ("wallet_challenges"."domain" ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$'),
	CONSTRAINT "wallet_challenges_message_integrity" CHECK (octet_length(convert_to("wallet_challenges"."message", 'UTF8')) BETWEEN 1 AND 4096 AND "wallet_challenges"."message_hash" ~ '^[0-9a-f]{64}$' AND "wallet_challenges"."message_hash" = encode(sha256(convert_to("wallet_challenges"."message", 'UTF8')), 'hex')),
	CONSTRAINT "wallet_challenges_time_order" CHECK (isfinite("wallet_challenges"."issued_at") AND isfinite("wallet_challenges"."expires_at") AND "wallet_challenges"."expires_at" > "wallet_challenges"."issued_at" AND ("wallet_challenges"."consumed_at" IS NULL OR "wallet_challenges"."consumed_at" >= "wallet_challenges"."issued_at" AND "wallet_challenges"."consumed_at" < "wallet_challenges"."expires_at"))
);
--> statement-breakpoint
CREATE TABLE "wallet_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "wallet_sessions_challenge_unique" UNIQUE("challenge_id"),
	CONSTRAINT "wallet_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "wallet_sessions_token_hash_format" CHECK ("wallet_sessions"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "wallet_sessions_time_order" CHECK (isfinite("wallet_sessions"."created_at") AND isfinite("wallet_sessions"."expires_at") AND "wallet_sessions"."expires_at" > "wallet_sessions"."created_at" AND ("wallet_sessions"."revoked_at" IS NULL OR "wallet_sessions"."revoked_at" >= "wallet_sessions"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" varchar(44) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_address_unique" UNIQUE("address"),
	CONSTRAINT "wallets_address_format" CHECK ("wallets"."address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
ALTER TABLE "wallet_challenges" ADD CONSTRAINT "wallet_challenges_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "wallet_sessions" ADD CONSTRAINT "wallet_sessions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "wallet_sessions" ADD CONSTRAINT "wallet_sessions_challenge_wallet_fk" FOREIGN KEY ("challenge_id","wallet_id") REFERENCES "public"."wallet_challenges"("id","wallet_id") ON DELETE cascade ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "wallet_challenges_wallet_index" ON "wallet_challenges" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallet_sessions_wallet_index" ON "wallet_sessions" USING btree ("wallet_id");
--> statement-breakpoint
-- Custom lifecycle guards must be retained alongside generated table snapshots.
CREATE FUNCTION public.protect_wallet_identity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Wallet identity cannot change'
    USING ERRCODE = '23514', CONSTRAINT = 'wallets_identity_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wallets_protect BEFORE UPDATE ON public.wallets
FOR EACH ROW EXECUTE FUNCTION public.protect_wallet_identity();
--> statement-breakpoint
CREATE FUNCTION public.consume_wallet_challenge() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  consumed_time timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Challenges start unused'
        USING ERRCODE = '23514', CONSTRAINT = 'wallet_challenges_unused_insert';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'consumed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'consumed_at') THEN
    RAISE EXCEPTION 'Signed challenge fields cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_challenges_immutable';
  END IF;
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'Challenges can only be consumed once'
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_challenges_single_use';
  END IF;
  consumed_time := clock_timestamp();
  IF consumed_time < OLD.issued_at OR consumed_time >= OLD.expires_at THEN
    RAISE EXCEPTION 'Challenge is not currently valid'
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_challenges_expired';
  END IF;
  NEW.consumed_at := consumed_time;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wallet_challenges_consume BEFORE INSERT OR UPDATE ON public.wallet_challenges
FOR EACH ROW EXECUTE FUNCTION public.consume_wallet_challenge();
--> statement-breakpoint
CREATE FUNCTION public.protect_wallet_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  challenge public.wallet_challenges%ROWTYPE;
  current_time_value timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Sessions start unrevoked'
        USING ERRCODE = '23514', CONSTRAINT = 'wallet_sessions_unrevoked_insert';
    END IF;
    SELECT * INTO challenge FROM public.wallet_challenges WHERE id = NEW.challenge_id FOR UPDATE;
    IF NOT FOUND OR challenge.wallet_id IS DISTINCT FROM NEW.wallet_id THEN
      RAISE EXCEPTION 'Session must match its challenge wallet'
        USING ERRCODE = '23503', CONSTRAINT = 'wallet_sessions_challenge_wallet_fk';
    END IF;
    current_time_value := clock_timestamp();
    IF challenge.consumed_at IS NULL OR current_time_value >= challenge.expires_at THEN
      RAISE EXCEPTION 'Session requires a consumed, unexpired challenge'
        USING ERRCODE = '23514', CONSTRAINT = 'wallet_sessions_challenge_valid';
    END IF;
    IF NEW.expires_at <= current_time_value THEN
      RAISE EXCEPTION 'Session must expire in the future'
        USING ERRCODE = '23514', CONSTRAINT = 'wallet_sessions_expiry_valid';
    END IF;
    NEW.created_at := current_time_value;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at') THEN
    RAISE EXCEPTION 'Session identity and expiry cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_sessions_immutable';
  END IF;
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Session revocation is permanent'
      USING ERRCODE = '23514', CONSTRAINT = 'wallet_sessions_revocation_once';
  END IF;
  NEW.revoked_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER wallet_sessions_protect BEFORE INSERT OR UPDATE ON public.wallet_sessions
FOR EACH ROW EXECUTE FUNCTION public.protect_wallet_session();
