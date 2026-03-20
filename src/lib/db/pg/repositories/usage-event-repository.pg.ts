import type { AdminUsageEventInsert } from "app-types/admin-dashboard";
import { generateUUID } from "lib/utils";
import { pgDb as db } from "../db.pg";
import { AdminUsageEventTable } from "../schema.pg";

export const pgUsageEventRepository = {
  async recordEvent(input: AdminUsageEventInsert) {
    await db.insert(AdminUsageEventTable).values({
      id: generateUUID(),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      eventName: input.eventName,
      actorUserId: input.actorUserId ?? null,
      source: input.source,
      status: input.status ?? "success",
      latencyMs: input.latencyMs ?? null,
      agentId: input.agentId ?? null,
      threadId: input.threadId ?? null,
      toolName: input.toolName ?? null,
      createdAt: input.createdAt ?? new Date(),
    });
  },

  async recordEvents(inputs: AdminUsageEventInsert[]) {
    if (inputs.length === 0) return;

    await db.insert(AdminUsageEventTable).values(
      inputs.map((input) => ({
        id: generateUUID(),
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        eventName: input.eventName,
        actorUserId: input.actorUserId ?? null,
        source: input.source,
        status: input.status ?? "success",
        latencyMs: input.latencyMs ?? null,
        agentId: input.agentId ?? null,
        threadId: input.threadId ?? null,
        toolName: input.toolName ?? null,
        createdAt: input.createdAt ?? new Date(),
      })),
    );
  },
};
