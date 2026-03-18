CREATE TABLE IF NOT EXISTS "admin_usage_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" uuid NOT NULL,
  "event_name" text NOT NULL,
  "actor_user_id" uuid REFERENCES "user"("id") ON DELETE set null,
  "source" text NOT NULL,
  "status" text NOT NULL DEFAULT 'success',
  "latency_ms" integer,
  "agent_id" uuid REFERENCES "agent"("id") ON DELETE set null,
  "thread_id" uuid REFERENCES "chat_thread"("id") ON DELETE set null,
  "tool_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_usage_event_resource_created_at_idx"
  ON "admin_usage_event" USING btree ("resource_type", "resource_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_usage_event_actor_created_at_idx"
  ON "admin_usage_event" USING btree ("resource_type", "actor_user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_usage_event_type_created_at_idx"
  ON "admin_usage_event" USING btree ("resource_type", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_usage_event_resource_event_created_at_idx"
  ON "admin_usage_event" USING btree ("resource_type", "resource_id", "event_name", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_agent_id_created_at_idx"
  ON "chat_message" USING btree (((metadata->>'agentId')), "created_at" DESC)
  WHERE "metadata" IS NOT NULL AND "metadata"->>'agentId' IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_usage_log_agent_kind_created_at_idx"
  ON "agent_external_usage_log" USING btree ("agent_id", "kind", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_usage_log_session_created_at_idx"
  ON "agent_external_usage_log" USING btree ("session_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_external_chat_session_agent_updated_at_idx"
  ON "agent_external_chat_session" USING btree ("agent_id", "updated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_usage_log_group_created_at_idx"
  ON "knowledge_usage_log" USING btree ("group_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_user_id_idx"
  ON "agent" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_server_user_id_idx"
  ON "mcp_server" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_user_id_idx"
  ON "workflow" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_node_workflow_id_idx"
  ON "workflow_node" USING btree ("workflow_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "skill_user_id_idx"
  ON "skill" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_group_user_id_idx"
  ON "knowledge_group" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_group_agent_group_id_idx"
  ON "knowledge_group_agent" USING btree ("group_id");
