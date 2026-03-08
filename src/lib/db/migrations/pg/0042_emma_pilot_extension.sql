CREATE TABLE IF NOT EXISTS "pilot_extension_auth_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"browser" text NOT NULL,
	"browser_version" text,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pilot_extension_auth_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pilot_extension_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"browser" text NOT NULL,
	"browser_version" text,
	"access_token_hash" text NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	"refresh_token_expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "pilot_extension_session_access_token_hash_unique" UNIQUE("access_token_hash"),
	CONSTRAINT "pilot_extension_session_refresh_token_hash_unique" UNIQUE("refresh_token_hash")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'pilot_extension_auth_code_code_hash_unique'
	) THEN
		ALTER TABLE "pilot_extension_auth_code"
			ADD CONSTRAINT "pilot_extension_auth_code_code_hash_unique" UNIQUE("code_hash");
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'pilot_extension_session_access_token_hash_unique'
	) THEN
		ALTER TABLE "pilot_extension_session"
			ADD CONSTRAINT "pilot_extension_session_access_token_hash_unique" UNIQUE("access_token_hash");
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'pilot_extension_session_refresh_token_hash_unique'
	) THEN
		ALTER TABLE "pilot_extension_session"
			ADD CONSTRAINT "pilot_extension_session_refresh_token_hash_unique" UNIQUE("refresh_token_hash");
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'pilot_extension_auth_code_user_id_user_id_fk'
	) THEN
		ALTER TABLE "pilot_extension_auth_code"
			ADD CONSTRAINT "pilot_extension_auth_code_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'pilot_extension_session_user_id_user_id_fk'
	) THEN
		ALTER TABLE "pilot_extension_session"
			ADD CONSTRAINT "pilot_extension_session_user_id_user_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_auth_code_user_id_idx" ON "pilot_extension_auth_code" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_auth_code_extension_id_idx" ON "pilot_extension_auth_code" USING btree ("extension_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_auth_code_expires_at_idx" ON "pilot_extension_auth_code" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_session_user_id_idx" ON "pilot_extension_session" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_session_extension_id_idx" ON "pilot_extension_session" USING btree ("extension_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pilot_extension_session_last_used_at_idx" ON "pilot_extension_session" USING btree ("last_used_at");
