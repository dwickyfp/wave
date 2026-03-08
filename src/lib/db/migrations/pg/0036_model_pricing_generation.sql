ALTER TABLE "llm_model_config"
ADD COLUMN IF NOT EXISTS "context_length" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "llm_model_config"
ADD COLUMN IF NOT EXISTS "input_token_price_per_1m_usd" numeric(12, 6) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "llm_model_config"
ADD COLUMN IF NOT EXISTS "output_token_price_per_1m_usd" numeric(12, 6) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "llm_model_config"
ADD COLUMN IF NOT EXISTS "supports_generation" boolean NOT NULL DEFAULT false;
