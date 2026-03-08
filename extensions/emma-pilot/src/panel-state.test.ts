import { describe, expect, it } from "vitest";
import {
  groupThreadsByDate,
  normalizeStoredPanelState,
  resolveThreadPreferences,
} from "./panel-state";

describe("emma pilot panel state", () => {
  it("groups threads into today, yesterday, last 7 days, and older", () => {
    const groups = groupThreadsByDate(
      [
        {
          id: "thread-1",
          title: "Today",
          createdAt: "2026-03-08T01:00:00.000Z",
          lastMessageAt: "2026-03-08T06:00:00.000Z",
        },
        {
          id: "thread-2",
          title: "Yesterday",
          createdAt: "2026-03-07T01:00:00.000Z",
          lastMessageAt: "2026-03-07T06:00:00.000Z",
        },
        {
          id: "thread-3",
          title: "Last week",
          createdAt: "2026-03-04T01:00:00.000Z",
          lastMessageAt: "2026-03-04T06:00:00.000Z",
        },
        {
          id: "thread-4",
          title: "Older",
          createdAt: "2026-02-20T01:00:00.000Z",
          lastMessageAt: "2026-02-20T06:00:00.000Z",
        },
      ],
      new Date("2026-03-08T12:00:00.000Z"),
    );

    expect(groups.map((group) => group.label)).toEqual([
      "Today",
      "Yesterday",
      "Last 7 days",
      "Older",
    ]);
  });

  it("prefers server selections before draft and defaults", () => {
    const preferences = resolveThreadPreferences({
      serverAgentId: "agent-server",
      serverChatModel: {
        provider: "openai",
        model: "GPT-4.1",
      },
      draft: {
        input: "draft text",
        selectedAgentId: "agent-draft",
        selectedChatModel: {
          provider: "anthropic",
          model: "Claude",
        },
      },
      defaultChatModel: {
        provider: "google",
        model: "Gemini",
      },
    });

    expect(preferences).toEqual({
      input: "draft text",
      selectedAgentId: "agent-server",
      selectedChatModel: {
        provider: "openai",
        model: "GPT-4.1",
      },
    });
  });

  it("always reopens into chat and preserves sidebar state", () => {
    expect(
      normalizeStoredPanelState({
        activeThreadId: "thread-1",
        sidebarOpen: false,
        view: "settings",
      }),
    ).toEqual({
      activeThreadId: "thread-1",
      sidebarOpen: false,
      drafts: {},
      view: "chat",
    });
  });
});
