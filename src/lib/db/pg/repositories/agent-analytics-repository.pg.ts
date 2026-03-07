import {
  AgentAutocompleteRequestSummary,
  AgentAutocompleteUsageStats,
  AgentDashboardStats,
  AgentExternalChatSessionSummary,
  AgentExternalUsageStatus,
  AgentInAppSessionSummary,
  AgentInAppUsageStats,
  AgentUsageTimelinePoint,
} from "app-types/agent-dashboard";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import { createHash } from "node:crypto";
import { pgDb as db } from "../db.pg";
import {
  AgentExternalChatSessionTable,
  AgentExternalUsageLogTable,
} from "../schema.pg";

const continueChatMessageSchema = z.object({
  role: z.enum(["system", "developer", "user", "assistant", "tool"]),
  content: z.unknown().optional(),
  tool_calls: z
    .array(
      z.object({
        function: z.object({
          name: z.string(),
        }),
      }),
    )
    .optional(),
  name: z.string().optional(),
  tool_call_id: z.string().optional(),
});

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeText(value: string | null | undefined, maxLength = 160) {
  const normalized = normalizeWhitespace(value ?? "");
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildClientFingerprint(userAgent: string | null | undefined) {
  return hashText(normalizeWhitespace(userAgent || "unknown-client"));
}

function normalizeMessageContent(content: unknown) {
  if (typeof content === "string") {
    return normalizeWhitespace(content);
  }

  if (Array.isArray(content)) {
    return normalizeWhitespace(
      content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          const candidate = part as { type?: string; text?: string };
          return candidate.type === "text" ? (candidate.text ?? "") : "";
        })
        .join(" "),
    );
  }

  return "";
}

function normalizeConversationMessages(
  messages: Array<z.infer<typeof continueChatMessageSchema>>,
) {
  return messages.map((message) => {
    const baseContent = normalizeMessageContent(message.content);
    const toolCallNames = (message.tool_calls ?? [])
      .map((toolCall) => toolCall.function.name)
      .filter(Boolean)
      .join(",");

    const suffix = toolCallNames ? ` tools:${toolCallNames}` : "";
    return `${message.role}:${baseContent}${suffix}`;
  });
}

function emptyTimeline(): AgentUsageTimelinePoint[] {
  return [];
}

function emptyInAppStats(): AgentInAppUsageStats {
  return {
    totalSessions: 0,
    totalAssistantMessages: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    daily: emptyTimeline(),
    recentSessions: [],
  };
}

function emptyExternalChatStats() {
  return {
    totalSessions: 0,
    totalTurns: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    daily: emptyTimeline(),
    recentSessions: [] as AgentExternalChatSessionSummary[],
  };
}

function emptyAutocompleteStats(): AgentAutocompleteUsageStats {
  return {
    totalRequests: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    daily: emptyTimeline(),
    recentRequests: [],
  };
}

function toIsoString(value: string | Date) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

export const pgAgentAnalyticsRepository = {
  async recordContinueChatUsage(input: {
    agentId: string;
    userAgent?: string | null;
    messages: Array<z.infer<typeof continueChatMessageSchema>>;
    requestPreview?: string | null;
    responsePreview?: string | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    finishReason?: string | null;
    status?: AgentExternalUsageStatus;
    modelProvider?: string | null;
    modelName?: string | null;
  }) {
    const normalizedMessages = normalizeConversationMessages(input.messages);
    const firstUserMessage = input.messages.find(
      (message) => message.role === "user",
    );
    const latestUserMessage = [...input.messages]
      .reverse()
      .find((message) => message.role === "user");

    const firstUserPreview =
      summarizeText(normalizeMessageContent(firstUserMessage?.content), 200) ||
      "New Continue session";
    const latestUserPreview =
      summarizeText(normalizeMessageContent(latestUserMessage?.content), 200) ||
      firstUserPreview;
    const clientFingerprint = buildClientFingerprint(input.userAgent);
    const firstUserMessageHash = hashText(firstUserPreview);
    const lastTranscriptMessageHash = hashText(
      normalizedMessages.at(-1) || latestUserPreview,
    );
    const requestMessageCount = input.messages.length;
    const createdAt = new Date();
    const promptTokens = input.promptTokens ?? 0;
    const completionTokens = input.completionTokens ?? 0;
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens;
    const status = input.status ?? "success";
    const recentThreshold = new Date(createdAt.getTime() - 1000 * 60 * 60 * 12);

    await db.transaction(async (transaction) => {
      const candidateSessions = await transaction
        .select()
        .from(AgentExternalChatSessionTable)
        .where(
          and(
            eq(AgentExternalChatSessionTable.agentId, input.agentId),
            eq(
              AgentExternalChatSessionTable.clientFingerprint,
              clientFingerprint,
            ),
            eq(
              AgentExternalChatSessionTable.firstUserMessageHash,
              firstUserMessageHash,
            ),
            gte(AgentExternalChatSessionTable.updatedAt, recentThreshold),
          ),
        )
        .orderBy(desc(AgentExternalChatSessionTable.updatedAt))
        .limit(12);

      const matchingSession = candidateSessions.find((session) => {
        if (requestMessageCount < session.lastMessageCount) {
          return false;
        }

        const priorMessage =
          normalizedMessages[session.lastMessageCount - 1] || latestUserPreview;

        return hashText(priorMessage) === session.lastTranscriptMessageHash;
      });

      const [session] = matchingSession
        ? await transaction
            .update(AgentExternalChatSessionTable)
            .set({
              lastTranscriptMessageHash,
              lastMessageCount: requestMessageCount,
              summaryPreview: latestUserPreview,
              turnCount: sql`${AgentExternalChatSessionTable.turnCount} + 1`,
              promptTokens: sql`${AgentExternalChatSessionTable.promptTokens} + ${promptTokens}`,
              completionTokens: sql`${AgentExternalChatSessionTable.completionTokens} + ${completionTokens}`,
              totalTokens: sql`${AgentExternalChatSessionTable.totalTokens} + ${totalTokens}`,
              lastModelProvider: input.modelProvider ?? null,
              lastModelName: input.modelName ?? null,
              lastStatus: status,
              updatedAt: createdAt,
            })
            .where(eq(AgentExternalChatSessionTable.id, matchingSession.id))
            .returning()
        : await transaction
            .insert(AgentExternalChatSessionTable)
            .values({
              id: generateUUID(),
              agentId: input.agentId,
              clientFingerprint,
              firstUserMessageHash,
              firstUserPreview,
              lastTranscriptMessageHash,
              lastMessageCount: requestMessageCount,
              summaryPreview: latestUserPreview,
              turnCount: 1,
              promptTokens,
              completionTokens,
              totalTokens,
              lastModelProvider: input.modelProvider ?? null,
              lastModelName: input.modelName ?? null,
              lastStatus: status,
              createdAt,
              updatedAt: createdAt,
            })
            .returning();

      await transaction.insert(AgentExternalUsageLogTable).values({
        id: generateUUID(),
        agentId: input.agentId,
        sessionId: session.id,
        transport: "continue_chat",
        kind: "chat_turn",
        modelProvider: input.modelProvider ?? null,
        modelName: input.modelName ?? null,
        promptTokens,
        completionTokens,
        totalTokens,
        finishReason: input.finishReason ?? null,
        status,
        requestPreview:
          summarizeText(input.requestPreview, 220) ?? latestUserPreview,
        responsePreview: summarizeText(input.responsePreview, 220),
        requestMessageCount,
        clientFingerprint,
        userAgent: input.userAgent ?? null,
        createdAt,
      });
    });
  },

  async recordContinueAutocompleteUsage(input: {
    agentId: string;
    userAgent?: string | null;
    requestPreview?: string | null;
    responsePreview?: string | null;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    finishReason?: string | null;
    status?: AgentExternalUsageStatus;
    modelProvider?: string | null;
    modelName?: string | null;
  }) {
    const promptTokens = input.promptTokens ?? 0;
    const completionTokens = input.completionTokens ?? 0;
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens;

    await db.insert(AgentExternalUsageLogTable).values({
      id: generateUUID(),
      agentId: input.agentId,
      sessionId: null,
      transport: "continue_autocomplete",
      kind: "autocomplete_request",
      modelProvider: input.modelProvider ?? null,
      modelName: input.modelName ?? null,
      promptTokens,
      completionTokens,
      totalTokens,
      finishReason: input.finishReason ?? null,
      status: input.status ?? "success",
      requestPreview: summarizeText(input.requestPreview, 220),
      responsePreview: summarizeText(input.responsePreview, 220),
      requestMessageCount: null,
      clientFingerprint: buildClientFingerprint(input.userAgent),
      userAgent: input.userAgent ?? null,
      createdAt: new Date(),
    });
  },

  async getDashboardStats(
    agentId: string,
    rangeDays = 30,
  ): Promise<AgentDashboardStats> {
    const since = new Date();
    since.setDate(since.getDate() - rangeDays);

    const [
      inAppTotalsResult,
      inAppDailyResult,
      inAppRecentResult,
      externalChatTotalsResult,
      externalChatDailyResult,
      externalChatRecentResult,
      autocompleteTotalsResult,
      autocompleteDailyResult,
      autocompleteRecentResult,
    ] = await Promise.all([
      db.execute<{
        total_sessions: number;
        total_messages: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }>(sql`
        SELECT
          COUNT(DISTINCT cm.thread_id)::int AS total_sessions,
          COUNT(*)::int AS total_messages,
          COALESCE(SUM((cm.metadata->'usage'->>'inputTokens')::numeric), 0)::int AS prompt_tokens,
          COALESCE(SUM((cm.metadata->'usage'->>'outputTokens')::numeric), 0)::int AS completion_tokens,
          COALESCE(SUM((cm.metadata->'usage'->>'totalTokens')::numeric), 0)::int AS total_tokens
        FROM chat_message cm
        WHERE cm.metadata->>'agentId' = ${agentId}
          AND cm.created_at >= ${since.toISOString()}
      `),
      db.execute<{
        date: string;
        requests: number;
        sessions: number;
        total_tokens: number;
      }>(sql`
        SELECT
          DATE(cm.created_at)::text AS date,
          COUNT(*)::int AS requests,
          COUNT(DISTINCT cm.thread_id)::int AS sessions,
          COALESCE(SUM((cm.metadata->'usage'->>'totalTokens')::numeric), 0)::int AS total_tokens
        FROM chat_message cm
        WHERE cm.metadata->>'agentId' = ${agentId}
          AND cm.created_at >= ${since.toISOString()}
        GROUP BY DATE(cm.created_at)
        ORDER BY date
      `),
      db.execute<{
        thread_id: string;
        title: string;
        assistant_messages: number;
        total_tokens: number;
        last_message_at: Date;
      }>(sql`
        SELECT
          ct.id AS thread_id,
          ct.title,
          COUNT(cm.id)::int AS assistant_messages,
          COALESCE(SUM((cm.metadata->'usage'->>'totalTokens')::numeric), 0)::int AS total_tokens,
          MAX(cm.created_at) AS last_message_at
        FROM chat_message cm
        INNER JOIN chat_thread ct ON ct.id = cm.thread_id
        WHERE cm.metadata->>'agentId' = ${agentId}
          AND cm.created_at >= ${since.toISOString()}
        GROUP BY ct.id, ct.title
        ORDER BY last_message_at DESC
        LIMIT 20
      `),
      db.execute<{
        total_sessions: number;
        total_turns: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }>(sql`
        SELECT
          COUNT(DISTINCT session_id)::int AS total_sessions,
          COUNT(*)::int AS total_turns,
          COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens
        FROM agent_external_usage_log
        WHERE agent_id = ${agentId}
          AND kind = 'chat_turn'
          AND created_at >= ${since.toISOString()}
      `),
      db.execute<{
        date: string;
        requests: number;
        sessions: number;
        total_tokens: number;
      }>(sql`
        SELECT
          DATE(created_at)::text AS date,
          COUNT(*)::int AS requests,
          COUNT(DISTINCT session_id)::int AS sessions,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens
        FROM agent_external_usage_log
        WHERE agent_id = ${agentId}
          AND kind = 'chat_turn'
          AND created_at >= ${since.toISOString()}
        GROUP BY DATE(created_at)
        ORDER BY date
      `),
      db.execute<{
        session_id: string;
        first_user_preview: string;
        summary_preview: string | null;
        total_turns: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        last_model_provider: string | null;
        last_model_name: string | null;
        last_status: AgentExternalUsageStatus;
        created_at: Date;
        updated_at: Date;
      }>(sql`
        SELECT
          s.id AS session_id,
          s.first_user_preview,
          s.summary_preview,
          COUNT(l.id)::int AS total_turns,
          COALESCE(SUM(l.prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(l.completion_tokens), 0)::int AS completion_tokens,
          COALESCE(SUM(l.total_tokens), 0)::int AS total_tokens,
          s.last_model_provider,
          s.last_model_name,
          s.last_status,
          s.created_at,
          s.updated_at
        FROM agent_external_chat_session s
        INNER JOIN agent_external_usage_log l ON l.session_id = s.id
        WHERE s.agent_id = ${agentId}
          AND l.kind = 'chat_turn'
          AND l.created_at >= ${since.toISOString()}
        GROUP BY
          s.id,
          s.first_user_preview,
          s.summary_preview,
          s.last_model_provider,
          s.last_model_name,
          s.last_status,
          s.created_at,
          s.updated_at
        ORDER BY s.updated_at DESC
        LIMIT 20
      `),
      db.execute<{
        total_requests: number;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS total_requests,
          COALESCE(SUM(prompt_tokens), 0)::int AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)::int AS completion_tokens,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens
        FROM agent_external_usage_log
        WHERE agent_id = ${agentId}
          AND kind = 'autocomplete_request'
          AND created_at >= ${since.toISOString()}
      `),
      db.execute<{
        date: string;
        requests: number;
        total_tokens: number;
      }>(sql`
        SELECT
          DATE(created_at)::text AS date,
          COUNT(*)::int AS requests,
          COALESCE(SUM(total_tokens), 0)::int AS total_tokens
        FROM agent_external_usage_log
        WHERE agent_id = ${agentId}
          AND kind = 'autocomplete_request'
          AND created_at >= ${since.toISOString()}
        GROUP BY DATE(created_at)
        ORDER BY date
      `),
      db.execute<{
        id: string;
        request_preview: string | null;
        response_preview: string | null;
        total_tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        model_provider: string | null;
        model_name: string | null;
        status: AgentExternalUsageStatus;
        created_at: Date;
      }>(sql`
        SELECT
          id,
          request_preview,
          response_preview,
          total_tokens,
          prompt_tokens,
          completion_tokens,
          model_provider,
          model_name,
          status,
          created_at
        FROM agent_external_usage_log
        WHERE agent_id = ${agentId}
          AND kind = 'autocomplete_request'
          AND created_at >= ${since.toISOString()}
        ORDER BY created_at DESC
        LIMIT 25
      `),
    ]);

    const inAppTotalsRow = inAppTotalsResult.rows[0];
    const externalChatTotalsRow = externalChatTotalsResult.rows[0];
    const autocompleteTotalsRow = autocompleteTotalsResult.rows[0];

    return {
      rangeDays,
      inApp: inAppTotalsRow
        ? {
            totalSessions: Number(inAppTotalsRow.total_sessions ?? 0),
            totalAssistantMessages: Number(inAppTotalsRow.total_messages ?? 0),
            totalTokens: Number(inAppTotalsRow.total_tokens ?? 0),
            promptTokens: Number(inAppTotalsRow.prompt_tokens ?? 0),
            completionTokens: Number(inAppTotalsRow.completion_tokens ?? 0),
            daily: inAppDailyResult.rows.map((row) => ({
              date: row.date,
              requests: Number(row.requests ?? 0),
              sessions: Number(row.sessions ?? 0),
              totalTokens: Number(row.total_tokens ?? 0),
            })),
            recentSessions: inAppRecentResult.rows.map(
              (row): AgentInAppSessionSummary => ({
                threadId: row.thread_id,
                title: row.title,
                assistantMessages: Number(row.assistant_messages ?? 0),
                totalTokens: Number(row.total_tokens ?? 0),
                lastMessageAt: toIsoString(row.last_message_at),
              }),
            ),
          }
        : emptyInAppStats(),
      externalChat: externalChatTotalsRow
        ? {
            totalSessions: Number(externalChatTotalsRow.total_sessions ?? 0),
            totalTurns: Number(externalChatTotalsRow.total_turns ?? 0),
            totalTokens: Number(externalChatTotalsRow.total_tokens ?? 0),
            promptTokens: Number(externalChatTotalsRow.prompt_tokens ?? 0),
            completionTokens: Number(
              externalChatTotalsRow.completion_tokens ?? 0,
            ),
            daily: externalChatDailyResult.rows.map((row) => ({
              date: row.date,
              requests: Number(row.requests ?? 0),
              sessions: Number(row.sessions ?? 0),
              totalTokens: Number(row.total_tokens ?? 0),
            })),
            recentSessions: externalChatRecentResult.rows.map(
              (row): AgentExternalChatSessionSummary => ({
                sessionId: row.session_id,
                firstUserPreview: row.first_user_preview,
                summaryPreview: row.summary_preview,
                totalTurns: Number(row.total_turns ?? 0),
                promptTokens: Number(row.prompt_tokens ?? 0),
                completionTokens: Number(row.completion_tokens ?? 0),
                totalTokens: Number(row.total_tokens ?? 0),
                lastModelProvider: row.last_model_provider,
                lastModelName: row.last_model_name,
                lastStatus: row.last_status,
                createdAt: toIsoString(row.created_at),
                updatedAt: toIsoString(row.updated_at),
              }),
            ),
          }
        : emptyExternalChatStats(),
      autocomplete: autocompleteTotalsRow
        ? {
            totalRequests: Number(autocompleteTotalsRow.total_requests ?? 0),
            totalTokens: Number(autocompleteTotalsRow.total_tokens ?? 0),
            promptTokens: Number(autocompleteTotalsRow.prompt_tokens ?? 0),
            completionTokens: Number(
              autocompleteTotalsRow.completion_tokens ?? 0,
            ),
            daily: autocompleteDailyResult.rows.map((row) => ({
              date: row.date,
              requests: Number(row.requests ?? 0),
              totalTokens: Number(row.total_tokens ?? 0),
            })),
            recentRequests: autocompleteRecentResult.rows.map(
              (row): AgentAutocompleteRequestSummary => ({
                id: row.id,
                requestPreview: row.request_preview,
                responsePreview: row.response_preview,
                totalTokens: Number(row.total_tokens ?? 0),
                promptTokens: Number(row.prompt_tokens ?? 0),
                completionTokens: Number(row.completion_tokens ?? 0),
                modelProvider: row.model_provider,
                modelName: row.model_name,
                status: row.status,
                createdAt: toIsoString(row.created_at),
              }),
            ),
          }
        : emptyAutocompleteStats(),
    };
  },
};
