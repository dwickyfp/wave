export type ChatModel = {
  provider: string;
  model: string;
};

export type PilotThreadSummary = {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastChatModel?: ChatModel | null;
  lastAgentId?: string | null;
};

export type ThreadDraftState = {
  input?: string;
  selectedAgentId?: string;
  selectedChatModel?: ChatModel | null;
};

export type StoredPanelState = {
  activeThreadId?: string | null;
  sidebarOpen?: boolean;
  drafts?: Record<string, ThreadDraftState>;
  view?: string;
};

export function normalizeStoredPanelState(stored?: StoredPanelState | null): {
  activeThreadId: string | null;
  sidebarOpen: boolean;
  drafts: Record<string, ThreadDraftState>;
  view: "chat";
} {
  return {
    activeThreadId: stored?.activeThreadId ?? null,
    sidebarOpen: stored?.sidebarOpen ?? true,
    drafts: stored?.drafts ?? {},
    view: "chat",
  };
}

export function resolveThreadPreferences(input: {
  serverAgentId?: string | null;
  serverChatModel?: ChatModel | null;
  draft?: ThreadDraftState | null;
  defaultChatModel?: ChatModel | null;
}) {
  return {
    input: input.draft?.input ?? "",
    selectedAgentId: input.serverAgentId ?? input.draft?.selectedAgentId ?? "",
    selectedChatModel:
      input.serverChatModel ??
      input.draft?.selectedChatModel ??
      input.defaultChatModel ??
      null,
  };
}

export function groupThreadsByDate(
  threads: PilotThreadSummary[],
  now = new Date(),
) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const groups = [
    { label: "Today", threads: [] as PilotThreadSummary[] },
    { label: "Yesterday", threads: [] as PilotThreadSummary[] },
    { label: "Last 7 days", threads: [] as PilotThreadSummary[] },
    { label: "Older", threads: [] as PilotThreadSummary[] },
  ];

  for (const thread of threads) {
    const threadDate = new Date(thread.lastMessageAt || thread.createdAt);
    threadDate.setHours(0, 0, 0, 0);

    if (threadDate.getTime() === today.getTime()) {
      groups[0].threads.push(thread);
    } else if (threadDate.getTime() === yesterday.getTime()) {
      groups[1].threads.push(thread);
    } else if (threadDate.getTime() >= lastWeek.getTime()) {
      groups[2].threads.push(thread);
    } else {
      groups[3].threads.push(thread);
    }
  }

  return groups.filter((group) => group.threads.length > 0);
}
