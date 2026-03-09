import { describe, expect, it } from "vitest";
import type { ChatMessage } from "app-types/chat";
import {
  SELF_LEARNING_PROPOSAL_THRESHOLD,
  buildPassiveHistoryCandidateSelection,
  buildPassiveHistoryCandidates,
  buildRecentUserMessageSnapshot,
} from "./candidates";

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): ChatMessage {
  return {
    id,
    threadId: "thread-1",
    role,
    parts: [{ type: "text", text }],
    metadata: undefined,
    createdAt: new Date(),
  };
}

describe("self-learning candidate extraction", () => {
  it("builds a deduplicated recent user snapshot from chat history", () => {
    const snapshot = buildRecentUserMessageSnapshot([
      [
        textMessage("u-1", "user", "Need a TypeScript implementation"),
        textMessage("a-1", "assistant", "Sure"),
        textMessage("u-2", "user", "Need a TypeScript implementation"),
      ],
      [textMessage("u-3", "user", "Keep the answer short and direct")],
    ]);

    expect(snapshot).toContain("Need a TypeScript implementation");
    expect(snapshot).toContain("Keep the answer short and direct");
    expect(snapshot?.match(/TypeScript implementation/g)?.length).toBe(1);
  });

  it("extracts passive candidates from assistant turns and skips excluded messages", () => {
    const messages = [
      textMessage("u-1", "user", "Implement the pagination"),
      textMessage("a-1", "assistant", "I will add pagination."),
      textMessage("u-2", "user", "Also keep it short."),
      textMessage("a-2", "assistant", "I will keep the answer concise."),
    ];

    const candidates = buildPassiveHistoryCandidates({
      threadMessagesByThread: [{ threadId: "thread-1", messages }],
      excludedMessageIds: new Set(["a-1"]),
      recentUserMessageSnapshot:
        "- Implement the pagination\n- Also keep it short.",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.messageId).toBe("a-2");
    expect(candidates[0]?.sourceType).toBe("passive_history");
    expect(candidates[0]?.sourceMetricScore).toBeGreaterThanOrEqual(0.2);
  });

  it("keeps the passive proposal threshold low enough for non-feedback learning", () => {
    expect(SELF_LEARNING_PROPOSAL_THRESHOLD).toBe(0.4);
  });

  it("excludes intro and small-talk prompts from passive history candidates", () => {
    const messages = [
      textMessage("u-1", "user", "Kamu siapa?"),
      textMessage("a-1", "assistant", "Saya Emma."),
      textMessage("u-2", "user", "Hari ini hari apa?"),
      textMessage("a-2", "assistant", "Hari ini Senin."),
    ];

    const result = buildPassiveHistoryCandidateSelection({
      threadMessagesByThread: [{ threadId: "thread-1", messages }],
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.diagnostics.smallTalkExcluded).toBe(2);
    expect(result.diagnostics.emptyReason).toBe("only_low_value_small_talk");
  });

  it("retains task-like multi-turn chats as passive history candidates", () => {
    const messages = [
      textMessage("u-1", "user", "Implement server pagination for the table"),
      textMessage(
        "a-1",
        "assistant",
        "I will switch the table to page-based loading.",
      ),
      textMessage("u-2", "user", "Also show an eligible-candidates column"),
      textMessage(
        "a-2",
        "assistant",
        "I will add the eligible column and keep the default sort data-first.",
      ),
    ];

    const result = buildPassiveHistoryCandidateSelection({
      threadMessagesByThread: [{ threadId: "thread-1", messages }],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.diagnostics.smallTalkExcluded).toBe(0);
    expect(result.diagnostics.finalCandidateCount).toBe(2);
  });
});
