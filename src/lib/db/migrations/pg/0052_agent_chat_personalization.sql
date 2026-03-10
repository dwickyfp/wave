ALTER TABLE "agent"
ADD COLUMN IF NOT EXISTS "chat_personalization_enabled" boolean DEFAULT true NOT NULL;
