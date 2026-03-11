CREATE TABLE IF NOT EXISTS "skill_group" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "user_id" uuid NOT NULL,
  "visibility" varchar(20) DEFAULT 'private' NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_group_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "skill_group"
      ADD CONSTRAINT "skill_group_user_id_user_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_group_skill" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "group_id" uuid NOT NULL,
  "skill_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "skill_group_skill_group_id_skill_id_unique" UNIQUE ("group_id", "skill_id")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_group_skill_group_id_skill_group_id_fk'
  ) THEN
    ALTER TABLE "skill_group_skill"
      ADD CONSTRAINT "skill_group_skill_group_id_skill_group_id_fk"
      FOREIGN KEY ("group_id")
      REFERENCES "public"."skill_group"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_group_skill_skill_id_skill_id_fk'
  ) THEN
    ALTER TABLE "skill_group_skill"
      ADD CONSTRAINT "skill_group_skill_skill_id_skill_id_fk"
      FOREIGN KEY ("skill_id")
      REFERENCES "public"."skill"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_group_skill_group_id_idx"
  ON "skill_group_skill" USING btree ("group_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_group_skill_skill_id_idx"
  ON "skill_group_skill" USING btree ("skill_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "skill_group_agent" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "group_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT "skill_group_agent_agent_id_group_id_unique" UNIQUE ("agent_id", "group_id")
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_group_agent_agent_id_agent_id_fk'
  ) THEN
    ALTER TABLE "skill_group_agent"
      ADD CONSTRAINT "skill_group_agent_agent_id_agent_id_fk"
      FOREIGN KEY ("agent_id")
      REFERENCES "public"."agent"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'skill_group_agent_group_id_skill_group_id_fk'
  ) THEN
    ALTER TABLE "skill_group_agent"
      ADD CONSTRAINT "skill_group_agent_group_id_skill_group_id_fk"
      FOREIGN KEY ("group_id")
      REFERENCES "public"."skill_group"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_group_agent_agent_id_idx"
  ON "skill_group_agent" USING btree ("agent_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "skill_group_agent_group_id_idx"
  ON "skill_group_agent" USING btree ("group_id");
