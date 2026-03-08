CREATE INDEX IF NOT EXISTS "chat_thread_user_id_created_at_idx"
  ON "chat_thread" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_thread_created_at_idx"
  ON "chat_thread" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_thread_id_created_at_idx"
  ON "chat_message" USING btree ("thread_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_created_at_idx"
  ON "chat_message" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "llm_model_config_provider_id_api_name_idx"
  ON "llm_model_config" USING btree ("provider_id", "api_name");
