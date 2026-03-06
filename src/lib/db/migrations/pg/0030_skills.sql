CREATE TABLE IF NOT EXISTS "skill" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "instructions" text NOT NULL,
  "user_id" uuid NOT NULL,
  "visibility" varchar(20) DEFAULT 'private' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "skill"
      ADD CONSTRAINT "skill_user_id_user_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_agent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "skill_agent_agent_id_skill_id_unique" UNIQUE ("agent_id", "skill_id")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_agent_agent_id_agent_id_fk'
  ) THEN
    ALTER TABLE "skill_agent"
      ADD CONSTRAINT "skill_agent_agent_id_agent_id_fk"
      FOREIGN KEY ("agent_id")
      REFERENCES "public"."agent"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_agent_skill_id_skill_id_fk'
  ) THEN
    ALTER TABLE "skill_agent"
      ADD CONSTRAINT "skill_agent_skill_id_skill_id_fk"
      FOREIGN KEY ("skill_id")
      REFERENCES "public"."skill"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_agent_agent_id_idx"
  ON "skill_agent" USING btree ("agent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_agent_skill_id_idx"
  ON "skill_agent" USING btree ("skill_id");
