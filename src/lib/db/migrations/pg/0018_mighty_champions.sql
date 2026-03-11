CREATE TABLE IF NOT EXISTS "chat_message_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "chat_message_feedback_message_id_user_id_unique" UNIQUE("message_id","user_id")
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_message_feedback_message_id_chat_message_id_fk') THEN
    ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_message_id_chat_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_message_feedback_user_id_user_id_fk') THEN
    ALTER TABLE "chat_message_feedback" ADD CONSTRAINT "chat_message_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_feedback_message_id_idx" ON "chat_message_feedback" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_feedback_user_id_idx" ON "chat_message_feedback" USING btree ("user_id");