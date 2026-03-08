import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Shield,
  ShieldCheck,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getToolName,
  isToolUIPart,
  parseJsonEventStream,
  readUIMessageStream,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { z } from "zod";
import {
  groupThreadsByDate,
  normalizeStoredPanelState,
  resolveThreadPreferences,
  type ChatModel,
  type PilotThreadSummary,
  type StoredPanelState,
  type ThreadDraftState,
} from "./panel-state";
import type {
  PageSnapshot as Snapshot,
  PilotModelProvider,
  PilotTaskState,
  PilotVisualContext,
} from "../../../src/types/pilot";
import {
  getLatestPilotTaskState,
  getLatestUserText,
  resolvePilotTaskMode,
} from "../../../src/lib/pilot/page-context";
import { PilotMarkdown } from "./pilot-markdown";
import {
  extractPilotProposalsFromMessage,
  getStableStreamItemKey,
  getToolStateLabel,
  shouldHidePilotToolPart,
  upsertStreamedMessage,
  withStableMessageId,
} from "./pilot-message-helpers";
import {
  buildPilotVisualContextForTurn,
  supportsPilotVision,
} from "./visual-context";
import {
  shouldAttemptPilotAutoConnect,
  shouldRefreshPilotAccessToken,
} from "./pilot-auth";
import {
  PILOT_SCROLLBAR_IDLE_MS,
  shouldKeepPilotScrollbarVisible,
} from "./scroll-visibility";

const AUTH_STORAGE_KEY = "emmaPilotAuth";
const AUTO_CONNECT_STORAGE_KEY = "emmaPilotAutoConnectDisabled";
const PANEL_STORAGE_KEY = "emmaPilotPanelStateV2";
const MODEL_REFRESH_MS = 1000 * 60 * 5;
const MAX_AUTO_CONTINUATIONS = 3;
const NEW_THREAD_KEY = "__new__";
let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;
const uiMessageChunkStreamSchema = z.any();

type ViewMode = "chat" | "settings";

type PilotAuth = {
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  user?: {
    id: string;
    email?: string;
    name?: string | null;
  };
};

type PilotConfig = {
  backendOrigin: string;
  authorizeUrlBase: string;
  release: {
    version: string;
    generatedAt: string;
    chrome: {
      downloadUrl: string | null;
    };
    edge: {
      downloadUrl: string | null;
    };
  };
  sessions: Array<{
    id: string;
    browser: "chrome" | "edge";
    browserVersion?: string | null;
    extensionId: string;
    lastUsedAt?: string | null;
    createdAt: string;
    revokedAt?: string | null;
  }>;
  latestThread: {
    id: string;
    title: string;
    url: string;
    lastMessageAt: string;
  } | null;
  agents: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  defaultChatModel: ChatModel | null;
};

type PilotProposal = {
  id: string;
  kind: string;
  label: string;
  explanation: string;
  elementId?: string;
  url?: string;
  value?: string;
  checked?: boolean;
  fields?: Array<{
    elementId: string;
    value: string;
  }>;
  requiresApproval?: boolean;
  isSensitive?: boolean;
};

type PilotActionResult = {
  proposalId: string;
  status: "succeeded" | "failed" | "skipped";
  summary: string;
  error?: string;
};

type PilotMessagePart = UIMessage["parts"][number];

type PilotMessage = UIMessage & {
  metadata?: {
    agentId?: string;
    chatModel?: ChatModel;
    pilotProposals?: PilotProposal[];
    pilotTaskState?: PilotTaskState;
  };
};

type PilotThreadDetail = {
  id: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastChatModel?: ChatModel | null;
  lastAgentId?: string | null;
  messages: PilotMessage[];
};

type DraftAttachment = {
  id: string;
  type: "file";
  url: string;
  mediaType?: string;
  filename?: string;
};

type BackgroundStatus = {
  auth?: PilotAuth | null;
  hasAllSitesPermission: boolean;
};

type RuntimeConfig = {
  backendOrigin: string;
  browser: "chrome" | "edge";
  version: string;
};

type TabInfo = {
  tabId?: number;
  url?: string;
  title?: string;
};

type PilotRequestContext = {
  auth?: PilotAuth | null;
  runtimeConfig?: RuntimeConfig | null;
};

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function isTextPilotPart(
  part: PilotMessagePart,
): part is Extract<PilotMessagePart, { type: "text" }> {
  return (
    part.type === "text" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

function isFilePilotPart(
  part: PilotMessagePart,
): part is Extract<PilotMessagePart, { type: "file" }> {
  return (
    part.type === "file" && typeof (part as { url?: unknown }).url === "string"
  );
}

function createModelValue(model: ChatModel | null | undefined) {
  if (!model?.provider || !model?.model) {
    return "";
  }
  return `${model.provider}::${model.model}`;
}

function parseModelValue(value: string): ChatModel | null {
  if (!value.includes("::")) {
    return null;
  }
  const [provider, model] = value.split("::");
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function formatShortDate(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatRelativeLine(thread: PilotThreadSummary) {
  const model = thread.lastChatModel
    ? `${thread.lastChatModel.provider}/${thread.lastChatModel.model}`
    : "Emma Pilot";

  return `${model} • ${formatShortDate(thread.lastMessageAt)}`;
}

async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  runtimeConfigPromise ??= (async () => {
    const response = await fetch(chrome.runtime.getURL("runtime-config.json"));
    if (!response.ok) {
      runtimeConfigPromise = null;
      throw new Error("Emma Pilot runtime config is missing.");
    }
    return await response.json();
  })();

  return await runtimeConfigPromise;
}

async function callBackground<T>(message: Record<string, unknown>): Promise<T> {
  return await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function consumePilotUIMessageStream(options: {
  response: Response;
  onMessage: (message: PilotMessage) => void;
}) {
  if (!options.response.ok) {
    const payload = await options.response.json().catch(() => ({}));
    throw new Error(payload.error || payload.message || "Request failed.");
  }

  if (!options.response.body) {
    throw new Error("Emma Pilot response stream is empty.");
  }

  const chunkStream = parseJsonEventStream({
    stream: options.response.body,
    schema: uiMessageChunkStreamSchema,
  }).pipeThrough(
    new TransformStream<
      { success: boolean; value?: unknown; error?: Error },
      any
    >({
      transform(chunk, controller) {
        if (!chunk.success) {
          throw chunk.error;
        }
        controller.enqueue(chunk.value);
      },
    }),
  );

  let latestMessage: PilotMessage | null = null;
  let streamMessageId = crypto.randomUUID();
  for await (const nextMessage of readUIMessageStream<PilotMessage>({
    stream: chunkStream,
  })) {
    const normalizedMessage = withStableMessageId(nextMessage, streamMessageId);
    streamMessageId = normalizedMessage.id;
    latestMessage = normalizedMessage;
    options.onMessage(normalizedMessage);
  }

  return latestMessage;
}

async function getStoredPanelState() {
  const result = await chrome.storage.local.get(PANEL_STORAGE_KEY);
  return normalizeStoredPanelState(
    (result[PANEL_STORAGE_KEY] as StoredPanelState | undefined) ?? undefined,
  );
}

async function saveStoredPanelState(input: {
  activeThreadId: string | null;
  sidebarOpen: boolean;
  drafts: Record<string, ThreadDraftState>;
}) {
  await chrome.storage.local.set({
    [PANEL_STORAGE_KEY]: {
      activeThreadId: input.activeThreadId,
      sidebarOpen: input.sidebarOpen,
      drafts: input.drafts,
      view: "chat",
    },
  });
}

async function setStoredAuth(auth: PilotAuth | null) {
  if (auth) {
    await chrome.storage.local.set({
      [AUTH_STORAGE_KEY]: auth,
    });
    return;
  }

  await chrome.storage.local.remove(AUTH_STORAGE_KEY);
}

async function getStoredAutoConnectDisabled() {
  const result = await chrome.storage.local.get(AUTO_CONNECT_STORAGE_KEY);
  return Boolean(result[AUTO_CONNECT_STORAGE_KEY]);
}

async function setStoredAutoConnectDisabled(disabled: boolean) {
  if (disabled) {
    await chrome.storage.local.set({
      [AUTO_CONNECT_STORAGE_KEY]: true,
    });
    return;
  }

  await chrome.storage.local.remove(AUTO_CONNECT_STORAGE_KEY);
}

export function EmmaPilotApp() {
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(
    null,
  );
  const [view, setView] = useState<ViewMode>("chat");
  const [auth, setAuth] = useState<PilotAuth | null>(null);
  const [config, setConfig] = useState<PilotConfig | null>(null);
  const [modelProviders, setModelProviders] = useState<PilotModelProvider[]>(
    [],
  );
  const [threads, setThreads] = useState<PilotThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PilotMessage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ThreadDraftState>>({});
  const [attachmentsByThread, setAttachmentsByThread] = useState<
    Record<string, DraftAttachment[]>
  >({});
  const [actionResultsByThread, setActionResultsByThread] = useState<
    Record<string, PilotActionResult[]>
  >({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hasAllSitesPermission, setHasAllSitesPermission] = useState(false);
  const [activeTab, setActiveTab] = useState<TabInfo | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [_statusMessage, setStatusMessage] = useState("");
  const [_pageError, setPageError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [_visualMode, setVisualMode] =
    useState<PilotVisualContext["mode"]>("dom-only");
  const [isMessagesScrolling, setIsMessagesScrolling] = useState(false);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [activeSelections, setActiveSelections] = useState<{
    selectedAgentId: string;
    selectedChatModel: ChatModel | null;
  }>({
    selectedAgentId: "",
    selectedChatModel: null,
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesContainerRef = useRef<HTMLElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const initStartedRef = useRef(false);
  const autoConnectAttemptedRef = useRef(false);
  const snapshotRefreshTimeoutRef = useRef<number | null>(null);
  const messagesScrollTimeoutRef = useRef<number | null>(null);

  const activeDraftKey = activeThreadId ?? NEW_THREAD_KEY;
  const currentDraft = drafts[activeDraftKey] ?? {};
  const currentAttachments = attachmentsByThread[activeDraftKey] ?? [];
  const currentActionResults = actionResultsByThread[activeDraftKey] ?? [];

  const groupedThreads = useMemo(() => groupThreadsByDate(threads), [threads]);
  const selectedModelSupportsVision = useMemo(
    () =>
      supportsPilotVision(
        modelProviders,
        activeSelections.selectedChatModel ?? null,
      ),
    [activeSelections.selectedChatModel, modelProviders],
  );
  const composerVisionLabel = "Copilot Browser Powered By Emma AI";

  const resizeComposerInput = useCallback(() => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, []);

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({
          block: "end",
          behavior,
        });
        return;
      }

      messagesContainerRef.current?.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior,
      });
    },
    [],
  );

  const handleMessagesScroll = useCallback(() => {
    const lastScrollAt = Date.now();
    setIsMessagesScrolling(
      shouldKeepPilotScrollbarVisible(lastScrollAt, lastScrollAt),
    );

    if (messagesScrollTimeoutRef.current !== null) {
      window.clearTimeout(messagesScrollTimeoutRef.current);
    }

    messagesScrollTimeoutRef.current = window.setTimeout(() => {
      setIsMessagesScrolling(shouldKeepPilotScrollbarVisible(lastScrollAt));
      messagesScrollTimeoutRef.current = null;
    }, PILOT_SCROLLBAR_IDLE_MS);
  }, []);

  const mergeActionResults = useCallback(
    (current: PilotActionResult[], next: PilotActionResult) => [
      ...current.filter((item) => item.proposalId !== next.proposalId),
      next,
    ],
    [],
  );

  const upsertAssistantMessage = useCallback((nextMessage: PilotMessage) => {
    setMessages((current) => upsertStreamedMessage(current, nextMessage));
  }, []);

  const persistPanelState = useCallback(
    async (
      nextActiveThreadId = activeThreadId,
      nextSidebarOpen = sidebarOpen,
      nextDrafts = drafts,
    ) => {
      await saveStoredPanelState({
        activeThreadId: nextActiveThreadId,
        sidebarOpen: nextSidebarOpen,
        drafts: nextDrafts,
      });
    },
    [activeThreadId, drafts, sidebarOpen],
  );

  const setDraftForKey = useCallback(
    (threadKey: string, patch: Partial<ThreadDraftState>) => {
      setDrafts((current) => {
        const nextDrafts = {
          ...current,
          [threadKey]: {
            ...current[threadKey],
            ...patch,
          },
        };
        void persistPanelState(activeThreadId, sidebarOpen, nextDrafts);
        return nextDrafts;
      });
    },
    [activeThreadId, persistPanelState, sidebarOpen],
  );

  const refreshSnapshot = useCallback(
    async (options?: { silent?: boolean }) => {
      let response:
        | {
            tab?: TabInfo;
            snapshot?: Snapshot;
            error?: string;
          }
        | undefined;

      try {
        response = await callBackground<{
          tab?: TabInfo;
          snapshot?: Snapshot;
          error?: string;
        }>({
          type: "pilot.collectSnapshot",
        });
        setActiveTab(response.tab ?? null);
        setSnapshot(response.snapshot ?? null);
        setPageError(response.error ?? "");
      } catch (error) {
        setSnapshot(null);
        setPageError(
          (error as Error).message || "Emma Pilot could not inspect this tab.",
        );
      }

      if (!options?.silent) {
        setStatusMessage("");
      }

      return response;
    },
    [],
  );

  const collectPilotVisualContext = useCallback(
    async (input: {
      snapshot?: Snapshot | null;
      userText: string;
      previousTaskState?: PilotTaskState;
      actionResultsCount?: number;
      modeOverride?: PilotTaskState["mode"];
    }) => {
      if (!input.snapshot || !selectedModelSupportsVision) {
        setVisualMode("dom-only");
        return undefined;
      }

      try {
        const response = await callBackground<{
          captureDataUrl?: string;
          mediaType?: string;
          error?: string;
        }>({
          type: "pilot.collectVisualContext",
        });

        if (response.error || !response.captureDataUrl) {
          setVisualMode("dom-only");
          return undefined;
        }

        const pageVisualContext = await buildPilotVisualContextForTurn({
          pageSnapshot: input.snapshot,
          captureDataUrl: response.captureDataUrl,
          userText: input.userText,
          previousTaskState: input.previousTaskState,
          actionResultsCount: input.actionResultsCount,
          modeOverride: input.modeOverride,
        });

        setVisualMode(pageVisualContext?.mode ?? "dom-only");
        return pageVisualContext;
      } catch {
        setVisualMode("dom-only");
        return undefined;
      }
    },
    [selectedModelSupportsVision],
  );

  const refreshAuthStatus = useCallback(async () => {
    const response = await callBackground<BackgroundStatus>({
      type: "pilot.getStatus",
    });
    setAuth(response.auth ?? null);
    setHasAllSitesPermission(Boolean(response.hasAllSitesPermission));
    return response.auth ?? null;
  }, []);

  const refreshPilotTokens = useCallback(
    async (context?: PilotRequestContext) => {
      const currentRuntimeConfig = context?.runtimeConfig ?? runtimeConfig;
      const currentAuth = context?.auth ?? auth;

      if (!currentRuntimeConfig || !currentAuth?.refreshToken) {
        throw new Error("Emma Pilot session expired.");
      }

      const response = await fetch(
        `${currentRuntimeConfig.backendOrigin}/api/pilot/auth/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            refreshToken: currentAuth.refreshToken,
          }),
        },
      );

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        await setStoredAuth(null);
        setAuth(null);
        throw new Error(payload.error || "Emma Pilot session expired.");
      }

      const nextAuth = {
        ...currentAuth,
        ...payload,
      } as PilotAuth;

      await setStoredAuth(nextAuth);
      setAuth(nextAuth);
      return nextAuth;
    },
    [auth, runtimeConfig],
  );

  const pilotFetchJson = useCallback(
    async <T,>(
      path: string,
      options: RequestInit = {},
      allowRefresh = true,
      context?: PilotRequestContext,
    ): Promise<T> => {
      const currentRuntimeConfig = context?.runtimeConfig ?? runtimeConfig;
      let currentAuth = context?.auth ?? auth;

      if (!currentRuntimeConfig || !currentAuth?.accessToken) {
        throw new Error("Emma Pilot session expired.");
      }

      if (
        allowRefresh &&
        shouldRefreshPilotAccessToken(currentAuth) &&
        currentAuth.refreshToken
      ) {
        currentAuth = await refreshPilotTokens({
          auth: currentAuth,
          runtimeConfig: currentRuntimeConfig,
        });
      }

      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${currentAuth.accessToken}`);
      const response = await fetch(
        `${currentRuntimeConfig.backendOrigin}${path}`,
        {
          ...options,
          headers,
        },
      );

      if (response.status === 401 && allowRefresh && currentAuth.refreshToken) {
        const refreshedAuth = await refreshPilotTokens({
          auth: currentAuth,
          runtimeConfig: currentRuntimeConfig,
        });
        return await pilotFetchJson<T>(path, options, false, {
          auth: refreshedAuth,
          runtimeConfig: currentRuntimeConfig,
        });
      }

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.message || "Request failed.");
      }

      return payload as T;
    },
    [auth, refreshPilotTokens, runtimeConfig],
  );

  const pilotFetchResponse = useCallback(
    async (
      path: string,
      options: RequestInit = {},
      allowRefresh = true,
      context?: PilotRequestContext,
    ) => {
      const currentRuntimeConfig = context?.runtimeConfig ?? runtimeConfig;
      let currentAuth = context?.auth ?? auth;

      if (!currentRuntimeConfig || !currentAuth?.accessToken) {
        throw new Error("Emma Pilot session expired.");
      }

      if (
        allowRefresh &&
        shouldRefreshPilotAccessToken(currentAuth) &&
        currentAuth.refreshToken
      ) {
        currentAuth = await refreshPilotTokens({
          auth: currentAuth,
          runtimeConfig: currentRuntimeConfig,
        });
      }

      const headers = new Headers(options.headers || {});
      headers.set("Authorization", `Bearer ${currentAuth.accessToken}`);
      const response = await fetch(
        `${currentRuntimeConfig.backendOrigin}${path}`,
        {
          ...options,
          headers,
        },
      );

      if (response.status === 401 && allowRefresh && currentAuth.refreshToken) {
        const refreshedAuth = await refreshPilotTokens({
          auth: currentAuth,
          runtimeConfig: currentRuntimeConfig,
        });
        return await pilotFetchResponse(path, options, false, {
          auth: refreshedAuth,
          runtimeConfig: currentRuntimeConfig,
        });
      }

      return response;
    },
    [auth, refreshPilotTokens, runtimeConfig],
  );

  const loadModels = useCallback(
    async (context?: PilotRequestContext) => {
      const currentAuth = context?.auth ?? auth;
      if (!currentAuth) {
        setModelProviders([]);
        return [];
      }

      const providers = await pilotFetchJson<PilotModelProvider[]>(
        "/api/pilot/models",
        {},
        true,
        context,
      );
      setModelProviders(providers);
      return providers;
    },
    [auth, pilotFetchJson],
  );

  const loadThreads = useCallback(
    async (context?: PilotRequestContext) => {
      const currentAuth = context?.auth ?? auth;
      if (!currentAuth) {
        setThreads([]);
        return [];
      }

      const nextThreads = await pilotFetchJson<PilotThreadSummary[]>(
        "/api/pilot/threads",
        {},
        true,
        context,
      );
      setThreads(nextThreads);
      return nextThreads;
    },
    [auth, pilotFetchJson],
  );

  const loadConfig = useCallback(
    async (context?: PilotRequestContext) => {
      const currentAuth = context?.auth ?? auth;
      if (!currentAuth) {
        setConfig(null);
        return null;
      }

      const nextConfig = await pilotFetchJson<PilotConfig>(
        "/api/pilot/config",
        {},
        true,
        context,
      );
      setConfig(nextConfig);
      return nextConfig;
    },
    [auth, pilotFetchJson],
  );

  const openThread = useCallback(
    async (
      threadId: string,
      options?: {
        context?: PilotRequestContext;
        defaultChatModel?: ChatModel | null;
      },
    ) => {
      setLoadingThreadId(threadId);
      setStatusMessage("");
      try {
        const detail = await pilotFetchJson<PilotThreadDetail>(
          `/api/pilot/threads/${threadId}`,
          {},
          true,
          options?.context,
        );

        const draft = drafts[threadId];
        const preferences = resolveThreadPreferences({
          serverAgentId: detail.lastAgentId,
          serverChatModel: detail.lastChatModel,
          draft,
          defaultChatModel:
            options?.defaultChatModel ?? config?.defaultChatModel,
        });

        setActiveThreadId(detail.id);
        setMessages(
          detail.messages.map((message, index) =>
            withStableMessageId(
              message,
              `${detail.id || "pilot-thread"}-message-${index}`,
            ),
          ),
        );
        setActiveSelections({
          selectedAgentId: preferences.selectedAgentId,
          selectedChatModel: preferences.selectedChatModel,
        });
        setDrafts((current) => {
          const nextDrafts = {
            ...current,
            [detail.id]: {
              ...current[detail.id],
              input: preferences.input,
              selectedAgentId: preferences.selectedAgentId,
              selectedChatModel: preferences.selectedChatModel,
            },
          };
          void persistPanelState(detail.id, sidebarOpen, nextDrafts);
          return nextDrafts;
        });
      } catch (error) {
        setStatusMessage(
          (error as Error).message || "Emma Pilot could not open this thread.",
        );
      } finally {
        setLoadingThreadId(null);
      }
    },
    [
      config?.defaultChatModel,
      drafts,
      persistPanelState,
      pilotFetchJson,
      sidebarOpen,
    ],
  );

  const startNewSession = useCallback(() => {
    const preferences = resolveThreadPreferences({
      draft: drafts[NEW_THREAD_KEY],
      defaultChatModel: config?.defaultChatModel,
    });

    setView("chat");
    setActiveThreadId(null);
    setMessages([]);
    setActiveSelections({
      selectedAgentId: preferences.selectedAgentId,
      selectedChatModel: preferences.selectedChatModel,
    });

    setDrafts((current) => {
      const nextDrafts = {
        ...current,
        [NEW_THREAD_KEY]: {
          input: "",
          selectedAgentId: preferences.selectedAgentId,
          selectedChatModel: preferences.selectedChatModel,
        },
      };
      void persistPanelState(null, sidebarOpen, nextDrafts);
      return nextDrafts;
    });
  }, [config?.defaultChatModel, drafts, persistPanelState, sidebarOpen]);

  const refreshPilotData = useCallback(
    async (options?: {
      initialThreadId?: string | null;
      authOverride?: PilotAuth | null;
      runtimeConfigOverride?: RuntimeConfig | null;
    }) => {
      const requestContext = {
        auth: options?.authOverride ?? auth,
        runtimeConfig: options?.runtimeConfigOverride ?? runtimeConfig,
      } satisfies PilotRequestContext;

      if (!requestContext.auth) {
        setConfig(null);
        setModelProviders([]);
        setThreads([]);
        setMessages([]);
        setActiveThreadId(null);
        return;
      }

      const [nextConfig, nextThreads] = await Promise.all([
        loadConfig(requestContext),
        loadThreads(requestContext),
        loadModels(requestContext),
      ]).then(
        ([loadedConfig, loadedThreads]) =>
          [loadedConfig, loadedThreads] as const,
      );

      const nextActiveThreadId =
        options?.initialThreadId &&
        nextThreads.some((thread) => thread.id === options.initialThreadId)
          ? options.initialThreadId
          : activeThreadId &&
              nextThreads.some((thread) => thread.id === activeThreadId)
            ? activeThreadId
            : (nextThreads[0]?.id ?? null);

      if (nextActiveThreadId) {
        await openThread(nextActiveThreadId, {
          context: requestContext,
          defaultChatModel: nextConfig?.defaultChatModel,
        });
      } else {
        const preferences = resolveThreadPreferences({
          draft: drafts[NEW_THREAD_KEY],
          defaultChatModel: nextConfig?.defaultChatModel,
        });
        setActiveSelections({
          selectedAgentId: preferences.selectedAgentId,
          selectedChatModel: preferences.selectedChatModel,
        });
        setMessages([]);
      }
    },
    [
      activeThreadId,
      auth,
      drafts,
      loadConfig,
      loadModels,
      loadThreads,
      openThread,
      runtimeConfig,
    ],
  );

  const refreshPilotSidebarData = useCallback(async () => {
    if (!auth) {
      return;
    }

    await Promise.all([loadConfig(), loadThreads(), loadModels()]);
  }, [auth, loadConfig, loadModels, loadThreads]);

  useEffect(() => {
    if (initStartedRef.current) {
      return;
    }

    initStartedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const [configValue, storedPanelState, nextAuth] = await Promise.all([
          fetchRuntimeConfig(),
          getStoredPanelState(),
          refreshAuthStatus(),
        ]);

        if (cancelled) return;

        setRuntimeConfig(configValue);
        setSidebarOpen(storedPanelState.sidebarOpen);
        setDrafts(storedPanelState.drafts);

        initializedRef.current = true;
        setLoading(false);

        void refreshSnapshot({ silent: true });

        if (nextAuth) {
          void refreshPilotData({
            initialThreadId: storedPanelState.activeThreadId,
            authOverride: nextAuth,
            runtimeConfigOverride: configValue,
          }).catch((error) => {
            if (!cancelled) {
              setStatusMessage(
                (error as Error).message ||
                  "Emma Pilot could not load your sessions.",
              );
            }
          });
        } else {
          startNewSession();

          const autoConnectDisabled = await getStoredAutoConnectDisabled();
          if (
            cancelled ||
            autoConnectAttemptedRef.current ||
            !shouldAttemptPilotAutoConnect({
              auth: nextAuth,
              autoConnectDisabled,
            })
          ) {
            return;
          }

          autoConnectAttemptedRef.current = true;

          const autoAuthResponse = await callBackground<{
            auth?: PilotAuth | null;
          }>({
            type: "pilot.tryAutoAuth",
          });

          if (!autoAuthResponse.auth || cancelled) {
            return;
          }

          setAuth(autoAuthResponse.auth);
          await setStoredAutoConnectDisabled(false);
          await setStoredAuth(autoAuthResponse.auth);
          await refreshPilotData({
            initialThreadId: storedPanelState.activeThreadId,
            authOverride: autoAuthResponse.auth,
            runtimeConfigOverride: configValue,
          });
          await refreshSnapshot({ silent: true });
        }
      } catch (error) {
        if (!cancelled) {
          setStatusMessage(
            (error as Error).message || "Emma Pilot failed to initialize.",
          );
          initializedRef.current = true;
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshAuthStatus, refreshPilotData, refreshSnapshot, startNewSession]);

  useEffect(() => {
    if (!auth || !initializedRef.current) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadModels().catch(() => undefined);
    }, MODEL_REFRESH_MS);

    const handleFocus = () => {
      void Promise.all([
        refreshAuthStatus(),
        loadModels(),
        refreshSnapshot({ silent: true }),
      ]).catch(() => undefined);
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [auth, loadModels, refreshAuthStatus, refreshSnapshot]);

  useEffect(() => {
    const scheduleSnapshotRefresh = (delay = 120) => {
      if (snapshotRefreshTimeoutRef.current !== null) {
        window.clearTimeout(snapshotRefreshTimeoutRef.current);
      }

      snapshotRefreshTimeoutRef.current = window.setTimeout(() => {
        snapshotRefreshTimeoutRef.current = null;
        void refreshSnapshot({ silent: true });
      }, delay);
    };

    const handleTabActivated = () => {
      scheduleSnapshotRefresh(80);
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: {
        status?: string;
        url?: string;
        title?: string;
      },
      tab: {
        active?: boolean;
      },
    ) => {
      if (!tab.active) {
        return;
      }

      if (
        changeInfo.status === "complete" ||
        typeof changeInfo.url === "string" ||
        typeof changeInfo.title === "string"
      ) {
        scheduleSnapshotRefresh(120);
      }
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      if (snapshotRefreshTimeoutRef.current !== null) {
        window.clearTimeout(snapshotRefreshTimeoutRef.current);
        snapshotRefreshTimeoutRef.current = null;
      }
      if (messagesScrollTimeoutRef.current !== null) {
        window.clearTimeout(messagesScrollTimeoutRef.current);
        messagesScrollTimeoutRef.current = null;
      }
    };
  }, [refreshSnapshot]);

  useEffect(() => {
    resizeComposerInput();
  }, [currentDraft.input, resizeComposerInput]);

  useEffect(() => {
    if (!selectedModelSupportsVision) {
      setVisualMode("dom-only");
    }
  }, [selectedModelSupportsVision]);

  useEffect(() => {
    if (!messages.length) {
      return;
    }

    scrollMessagesToBottom(sending ? "auto" : "smooth");
  }, [messages, scrollMessagesToBottom, sending]);

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((current) => {
      const next = !current;
      void persistPanelState(activeThreadId, next, drafts);
      return next;
    });
  }, [activeThreadId, drafts, persistPanelState]);

  const handleConnect = useCallback(async () => {
    setStatusMessage("");
    setSending(true);

    try {
      const response = await callBackground<{
        auth?: PilotAuth;
        error?: string;
      }>({
        type: "pilot.startAuth",
      });

      if (response.error || !response.auth) {
        throw new Error(response.error || "Emma Pilot sign-in failed.");
      }

      setAuth(response.auth);
      await setStoredAutoConnectDisabled(false);
      await setStoredAuth(response.auth);
      await refreshPilotData({
        authOverride: response.auth,
        runtimeConfigOverride: runtimeConfig,
      });
      await refreshSnapshot({ silent: true });
    } catch (error) {
      setStatusMessage(
        (error as Error).message || "Emma Pilot sign-in failed.",
      );
    } finally {
      setSending(false);
    }
  }, [refreshPilotData, refreshSnapshot, runtimeConfig]);

  const handleDisconnect = useCallback(async () => {
    setStatusMessage("");
    setSending(true);

    try {
      if (runtimeConfig && auth?.accessToken) {
        await fetch(`${runtimeConfig.backendOrigin}/api/pilot/auth/revoke`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
          },
        }).catch(() => undefined);
      }

      await callBackground({
        type: "pilot.clearAuth",
      });
      await setStoredAutoConnectDisabled(true);
      await setStoredAuth(null);
      setAuth(null);
      setConfig(null);
      setModelProviders([]);
      setThreads([]);
      startNewSession();
    } finally {
      setSending(false);
    }
  }, [auth?.accessToken, runtimeConfig, startNewSession]);

  const handleGrantPermission = useCallback(async () => {
    const response = await callBackground<{
      granted: boolean;
    }>({
      type: "pilot.requestAllSites",
    });
    setHasAllSitesPermission(Boolean(response.granted));
    if (response.granted) {
      await refreshSnapshot({ silent: true });
    } else {
      setStatusMessage("Emma Pilot is using current-tab access only.");
    }
  }, [refreshSnapshot]);

  const handleDraftInputChange = useCallback(
    (value: string) => {
      setDraftForKey(activeDraftKey, {
        input: value,
      });
    },
    [activeDraftKey, setDraftForKey],
  );

  const handleAgentChange = useCallback(
    (value: string) => {
      setActiveSelections((current) => ({
        ...current,
        selectedAgentId: value,
      }));
      setDraftForKey(activeDraftKey, {
        selectedAgentId: value,
      });
    },
    [activeDraftKey, setDraftForKey],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      const nextModel = parseModelValue(value);
      setActiveSelections((current) => ({
        ...current,
        selectedChatModel: nextModel,
      }));
      setDraftForKey(activeDraftKey, {
        selectedChatModel: nextModel,
      });
    },
    [activeDraftKey, setDraftForKey],
  );

  const handleUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || !fileList.length || !auth) {
        return;
      }

      setSending(true);
      try {
        const uploadedEntries: DraftAttachment[] = [];
        for (const file of Array.from(fileList)) {
          const formData = new FormData();
          formData.append("file", file);
          const uploaded = await pilotFetchJson<{
            url: string;
          }>("/api/pilot/storage/upload", {
            method: "POST",
            body: formData,
          });
          uploadedEntries.push({
            id: crypto.randomUUID(),
            type: "file",
            url: uploaded.url,
            mediaType: file.type,
            filename: file.name,
          });
        }

        setAttachmentsByThread((current) => ({
          ...current,
          [activeDraftKey]: [
            ...(current[activeDraftKey] ?? []),
            ...uploadedEntries,
          ],
        }));
      } catch (error) {
        setStatusMessage(
          (error as Error).message || "Emma Pilot could not upload the file.",
        );
      } finally {
        setSending(false);
      }
    },
    [activeDraftKey, auth, pilotFetchJson],
  );

  const handleRemoveAttachment = useCallback(
    (attachmentId: string) => {
      setAttachmentsByThread((current) => ({
        ...current,
        [activeDraftKey]: (current[activeDraftKey] ?? []).filter(
          (attachment) => attachment.id !== attachmentId,
        ),
      }));
    },
    [activeDraftKey],
  );

  const runProposalExecution = useCallback(
    async (proposal: PilotProposal, threadKey = activeDraftKey) => {
      const result = await callBackground<
        PilotActionResult & { error?: string }
      >({
        type: "pilot.executeAction",
        proposal,
      });

      const normalizedResult: PilotActionResult = {
        proposalId: proposal.id,
        status: result.status || "failed",
        summary:
          result.summary || "Emma Pilot could not execute the browser action.",
        error: result.error,
      };

      setActionResultsByThread((current) => ({
        ...current,
        [threadKey]: [
          ...(current[threadKey] ?? []).filter(
            (item) => item.proposalId !== proposal.id,
          ),
          normalizedResult,
        ],
      }));

      setStatusMessage(normalizedResult.summary);

      if (proposal.kind === "navigate") {
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      await refreshSnapshot({ silent: true });
      return normalizedResult;
    },
    [activeDraftKey, refreshSnapshot],
  );

  const requestContinuation = useCallback(
    async (
      threadId: string,
      actionResults: PilotActionResult[],
      previousTaskState?: PilotTaskState,
    ): Promise<PilotMessage | null> => {
      const latestPageState = await refreshSnapshot({ silent: true });
      const nextTab = latestPageState?.tab ?? activeTab;
      const nextSnapshot = latestPageState?.snapshot ?? snapshot;

      if (!nextTab?.url) {
        return null;
      }

      const pageVisualContext = await collectPilotVisualContext({
        snapshot: nextSnapshot,
        userText: getLatestUserText(messages),
        previousTaskState:
          previousTaskState ?? getLatestPilotTaskState(messages),
        actionResultsCount: actionResults.length,
        modeOverride: "continue",
      });

      const response = await pilotFetchResponse("/api/pilot/chat/continue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          threadId,
          tabContext: {
            tabId: nextTab.tabId,
            url: nextTab.url,
            title: nextTab.title || nextSnapshot?.title || "",
            origin: nextTab.url ? new URL(nextTab.url).origin : undefined,
          },
          pageSnapshot: nextSnapshot || undefined,
          pageVisualContext,
          approvedActionIds: actionResults.map((result) => result.proposalId),
          actionResults,
          stream: true,
        }),
      });

      return await consumePilotUIMessageStream({
        response,
        onMessage: upsertAssistantMessage,
      });
    },
    [
      activeTab,
      collectPilotVisualContext,
      messages,
      pilotFetchResponse,
      refreshSnapshot,
      snapshot,
      upsertAssistantMessage,
    ],
  );

  const runAgenticContinuation = useCallback(
    async (input: {
      threadId: string;
      assistantMessage?: PilotMessage | null;
      seedActionResults?: PilotActionResult[];
    }) => {
      let accumulatedResults = [...(input.seedActionResults ?? [])];
      let latestAssistant = input.assistantMessage ?? null;
      let continuationCount = 0;

      while (continuationCount <= MAX_AUTO_CONTINUATIONS) {
        const automaticProposals = extractPilotProposalsFromMessage(
          latestAssistant,
        ).filter((proposal) => !proposal.requiresApproval);

        if (!automaticProposals.length) {
          break;
        }

        for (const proposal of automaticProposals) {
          const result = await runProposalExecution(proposal, input.threadId);
          accumulatedResults = mergeActionResults(accumulatedResults, result);
        }

        if (continuationCount >= MAX_AUTO_CONTINUATIONS) {
          setStatusMessage(
            "Emma Pilot paused after several automatic steps. Review the latest result before continuing.",
          );
          break;
        }

        latestAssistant = await requestContinuation(
          input.threadId,
          accumulatedResults,
          latestAssistant?.metadata?.pilotTaskState,
        );

        if (!latestAssistant) {
          break;
        }

        continuationCount += 1;

        const extractedNextProposals =
          extractPilotProposalsFromMessage(latestAssistant);
        if (!extractedNextProposals.length) {
          break;
        }

        if (
          extractedNextProposals.some((proposal) => proposal.requiresApproval)
        ) {
          break;
        }
      }

      return accumulatedResults;
    },
    [
      mergeActionResults,
      requestContinuation,
      runProposalExecution,
      setStatusMessage,
    ],
  );

  const handleApproveProposal = useCallback(
    async (proposal: PilotProposal) => {
      if (!activeThreadId) {
        return;
      }

      setSending(true);
      setStatusMessage("");

      try {
        const result = await runProposalExecution(proposal, activeThreadId);
        const nextResults = mergeActionResults(currentActionResults, result);
        await runAgenticContinuation({
          threadId: activeThreadId,
          seedActionResults: nextResults,
        });
        await refreshPilotSidebarData();
      } catch (error) {
        setStatusMessage(
          (error as Error).message ||
            "Emma Pilot could not execute the action.",
        );
      } finally {
        setSending(false);
      }
    },
    [
      activeThreadId,
      currentActionResults,
      mergeActionResults,
      refreshPilotSidebarData,
      runAgenticContinuation,
      runProposalExecution,
    ],
  );

  const handleSendMessage = useCallback(async () => {
    if (!auth) {
      setStatusMessage("Connect Emma Pilot from settings before chatting.");
      return;
    }

    const previousMessages = messages;
    const originalInput = currentDraft.input ?? "";
    const text = originalInput.trim();
    if (!text || sending) {
      return;
    }

    setDraftForKey(activeDraftKey, {
      input: "",
    });
    window.requestAnimationFrame(() => resizeComposerInput());
    setSending(true);
    setStatusMessage("");
    let assistantStreamed = false;

    try {
      const latestPageState = await refreshSnapshot({ silent: true });
      const nextTab = latestPageState?.tab ?? activeTab;
      const nextSnapshot = latestPageState?.snapshot ?? snapshot;

      if (!nextTab?.url) {
        throw new Error("Emma Pilot could not read the active tab.");
      }

      const pageVisualContext = await collectPilotVisualContext({
        snapshot: nextSnapshot,
        userText: text,
        previousTaskState: getLatestPilotTaskState(messages),
        actionResultsCount: 0,
        modeOverride: resolvePilotTaskMode({
          userText: text,
          previousState: getLatestPilotTaskState(messages),
        }),
      });

      const userMessage: PilotMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        metadata: {
          agentId: activeSelections.selectedAgentId || undefined,
          chatModel: activeSelections.selectedChatModel || undefined,
        },
      };

      const currentMessages = [...previousMessages, userMessage];
      setMessages(currentMessages);

      const selectedAgent = config?.agents.find(
        (agent) => agent.id === activeSelections.selectedAgentId,
      );
      const seedActionResults = [...currentActionResults];

      const nextThreadId = activeThreadId || crypto.randomUUID();

      const response = await pilotFetchResponse("/api/pilot/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          threadId: nextThreadId,
          message: userMessage,
          mentions: selectedAgent
            ? [
                {
                  type: "agent",
                  agentId: selectedAgent.id,
                  name: selectedAgent.name,
                  description: selectedAgent.description || "",
                },
              ]
            : [],
          attachments: currentAttachments.map((attachment) => ({
            type: attachment.type,
            url: attachment.url,
            mediaType: attachment.mediaType,
            filename: attachment.filename,
          })),
          tabContext: {
            tabId: nextTab.tabId,
            url: nextTab.url,
            title: nextTab.title || nextSnapshot?.title || "",
            origin: nextTab.url ? new URL(nextTab.url).origin : undefined,
          },
          pageSnapshot: nextSnapshot || undefined,
          pageVisualContext,
          approvedActionIds: currentActionResults.map(
            (result) => result.proposalId,
          ),
          actionResults: currentActionResults,
          chatModel: activeSelections.selectedChatModel || undefined,
          stream: true,
        }),
      });

      setActiveThreadId(nextThreadId);
      setDrafts((current) => {
        const currentDraftState = current[activeDraftKey] ?? {};
        const nextDrafts = {
          ...current,
          [nextThreadId]: {
            ...current[nextThreadId],
            input: "",
            selectedAgentId:
              currentDraftState.selectedAgentId ??
              activeSelections.selectedAgentId,
            selectedChatModel:
              currentDraftState.selectedChatModel ??
              activeSelections.selectedChatModel,
          },
          [activeDraftKey]: {
            ...currentDraftState,
            input: "",
          },
        };
        void persistPanelState(nextThreadId, sidebarOpen, nextDrafts);
        return nextDrafts;
      });
      setAttachmentsByThread((current) => ({
        ...current,
        [activeDraftKey]: [],
        [nextThreadId]: [],
      }));
      setActionResultsByThread((current) => ({
        ...current,
        [activeDraftKey]: [],
        [nextThreadId]: seedActionResults,
      }));

      const assistantMessage = await consumePilotUIMessageStream({
        response,
        onMessage: (message) => {
          assistantStreamed = true;
          upsertAssistantMessage(message);
        },
      });

      await runAgenticContinuation({
        threadId: nextThreadId,
        assistantMessage,
        seedActionResults,
      });

      await refreshPilotSidebarData();
    } catch (error) {
      setDraftForKey(activeDraftKey, {
        input: originalInput,
      });
      setStatusMessage(
        (error as Error).message || "Emma Pilot request failed.",
      );
      if (!assistantStreamed) {
        setMessages(previousMessages);
      }
    } finally {
      setSending(false);
    }
  }, [
    activeSelections.selectedAgentId,
    activeSelections.selectedChatModel,
    activeTab,
    activeThreadId,
    auth,
    config?.agents,
    currentActionResults,
    currentAttachments,
    currentDraft.input,
    collectPilotVisualContext,
    persistPanelState,
    pilotFetchResponse,
    refreshPilotSidebarData,
    refreshSnapshot,
    resizeComposerInput,
    runAgenticContinuation,
    sidebarOpen,
    snapshot,
    activeDraftKey,
    messages,
    setDraftForKey,
    upsertAssistantMessage,
  ]);

  const handleOpenEmma = useCallback(() => {
    if (!runtimeConfig) return;
    const path = activeThreadId ? `/chat/${activeThreadId}` : "/";
    chrome.tabs.create({
      url: `${runtimeConfig.backendOrigin}${path}`,
    });
  }, [activeThreadId, runtimeConfig]);

  if (loading) {
    return (
      <div className="pilot-app pilot-loading">
        <Loader2 className="pilot-spinner" />
        <p>Loading Emma Pilot…</p>
      </div>
    );
  }

  return (
    <div className="pilot-app">
      <header className="pilot-header">
        <div className="pilot-header-status">
          <span className="pilot-badge is-success pilot-secure-badge">
            <ShieldCheck className="size-3" />
            Secure
          </span>
        </div>
        <div className="pilot-header-actions">
          {view === "settings" ? (
            <button
              className="pilot-icon-button"
              onClick={() => setView("chat")}
              title="Back to chat"
              type="button"
            >
              <ArrowLeft className="size-3" />
            </button>
          ) : (
            <Fragment>
              <button
                className="pilot-icon-button"
                onClick={startNewSession}
                title="New session"
                type="button"
              >
                <Plus className="size-3" />
              </button>
              <button
                className="pilot-icon-button"
                onClick={handleSidebarToggle}
                title="Toggle session history"
                type="button"
              >
                {sidebarOpen ? (
                  <PanelRightClose className="size-3" />
                ) : (
                  <PanelRightOpen className="size-3" />
                )}
              </button>
              <button
                className="pilot-icon-button"
                onClick={() => setView("settings")}
                title="Settings"
                type="button"
              >
                <Settings className="size-3" />
              </button>
            </Fragment>
          )}
        </div>
      </header>

      {view === "settings" ? (
        <SettingsView
          auth={auth}
          config={config}
          hasAllSitesPermission={hasAllSitesPermission}
          activeTab={activeTab}
          runtimeConfig={runtimeConfig}
          sending={sending}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onGrantPermission={handleGrantPermission}
          onRefreshPageContext={() => void refreshSnapshot()}
          onOpenEmma={handleOpenEmma}
        />
      ) : (
        <div className="pilot-workspace">
          <main className="pilot-chat-column">
            <section
              ref={messagesContainerRef}
              className={clsx(
                "pilot-messages",
                isMessagesScrolling && "is-scrolling",
              )}
              onScroll={handleMessagesScroll}
            >
              {!auth ? (
                <EmptyState
                  title="Connect Emma Pilot"
                  description="Open settings to connect your Emma account, grant site access, and start chatting."
                  actionLabel="Open settings"
                  onAction={() => setView("settings")}
                />
              ) : messages.length === 0 ? (
                <EmptyState
                  title="Start a new Emma Pilot session"
                  description="Type your request below. Emma Pilot understands natural language about the current page."
                />
              ) : (
                messages.map((message, index) => (
                  <MessageCard
                    key={getStableStreamItemKey({
                      messageId: message.id,
                      preferredKey: message.id,
                      fallbackLabel: message.role,
                      index,
                    })}
                    message={message}
                    isActive={index === messages.length - 1}
                    isStreaming={sending && index === messages.length - 1}
                    actionResults={currentActionResults}
                    onApproveProposal={handleApproveProposal}
                  />
                ))
              )}
              <div ref={messagesEndRef} />
            </section>

            <div className="pilot-composer-dock">
              <form
                className="pilot-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSendMessage();
                }}
              >
                <div className="pilot-composer-body">
                  <textarea
                    ref={composerTextareaRef}
                    className="pilot-composer-input"
                    value={currentDraft.input ?? ""}
                    onChange={(event) => {
                      handleDraftInputChange(event.target.value);
                      resizeComposerInput();
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    placeholder="Ask Emma Pilot anything about this page"
                    rows={1}
                    disabled={!auth || sending}
                  />

                  {currentAttachments.length ? (
                    <div className="pilot-attachment-row">
                      {currentAttachments.map((attachment) => (
                        <button
                          key={attachment.id}
                          className="pilot-attachment-pill"
                          onClick={() => handleRemoveAttachment(attachment.id)}
                          type="button"
                        >
                          {attachment.filename || "Attachment"}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="pilot-composer-toolbar">
                  <div className="pilot-toolbar-left">
                    <input
                      ref={fileInputRef}
                      className="hidden-input"
                      type="file"
                      multiple
                      onChange={(event) => {
                        void handleUploadFiles(event.target.files);
                        event.currentTarget.value = "";
                      }}
                    />
                    <button
                      className="pilot-icon-button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={!auth || sending}
                      title="Add files"
                      type="button"
                    >
                      <Plus className="size-4" />
                    </button>

                    <div className="pilot-select-shell">
                      <select
                        className="pilot-select"
                        value={createModelValue(
                          activeSelections.selectedChatModel,
                        )}
                        onChange={(event) =>
                          handleModelChange(event.target.value)
                        }
                        disabled={!auth || sending}
                      >
                        <option value="">Select model</option>
                        {modelProviders.map((provider) => (
                          <optgroup
                            key={provider.provider}
                            label={`${provider.provider}${provider.hasAPIKey ? "" : " (No API key)"}`}
                          >
                            {provider.models.map((model) => (
                              <option
                                key={`${provider.provider}-${model.name}`}
                                value={`${provider.provider}::${model.name}`}
                                disabled={!provider.hasAPIKey}
                              >
                                {model.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <ChevronDown className="size-3 pilot-select-chevron" />
                    </div>

                    <div className="pilot-select-shell">
                      <select
                        className="pilot-select"
                        value={activeSelections.selectedAgentId}
                        onChange={(event) =>
                          handleAgentChange(event.target.value)
                        }
                        disabled={!auth || sending}
                      >
                        <option value="">Emma Pilot</option>
                        {config?.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="size-3 pilot-select-chevron" />
                    </div>
                  </div>

                  <div className="pilot-toolbar-right">
                    <button
                      className="pilot-send-button"
                      disabled={
                        !auth || sending || !(currentDraft.input || "").trim()
                      }
                      type="submit"
                    >
                      {sending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
              </form>

              <p className="pilot-composer-label">{composerVisionLabel}</p>
            </div>
          </main>

          <aside
            className={clsx(
              "pilot-history-panel",
              sidebarOpen ? "is-open" : "",
            )}
          >
            <div className="pilot-history-header">
              <div>
                <p className="pilot-panel-title">Sessions</p>
                <p className="pilot-panel-subtitle">Emma Pilot threads only</p>
              </div>
              <button
                className="pilot-secondary-button"
                onClick={startNewSession}
                type="button"
              >
                New session
              </button>
            </div>

            <div className="pilot-history-list">
              {!threads.length ? (
                <div className="pilot-history-empty">
                  No Emma Pilot sessions yet.
                </div>
              ) : (
                groupedThreads.map((group) => (
                  <div key={group.label} className="pilot-history-group">
                    <p className="pilot-history-group-label">{group.label}</p>
                    <div className="pilot-history-group-items">
                      {group.threads.map((thread) => (
                        <button
                          key={thread.id}
                          className={clsx(
                            "pilot-thread-item",
                            activeThreadId === thread.id && "is-active",
                          )}
                          disabled={loadingThreadId === thread.id}
                          onClick={() => void openThread(thread.id)}
                          type="button"
                        >
                          <div className="pilot-thread-title-row">
                            <span className="pilot-thread-title">
                              {thread.title || "New session"}
                            </span>
                            {loadingThreadId === thread.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : null}
                          </div>
                          <span className="pilot-thread-meta">
                            {formatRelativeLine(thread)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>

          {sidebarOpen ? (
            <button
              className="pilot-sidebar-backdrop"
              onClick={handleSidebarToggle}
              type="button"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function EmptyState(props: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="pilot-empty-state">
      <h2>{props.title}</h2>
      <p>{props.description}</p>
      {props.actionLabel && props.onAction ? (
        <button
          className="pilot-primary-button"
          onClick={props.onAction}
          type="button"
        >
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function SettingsView(props: {
  auth: PilotAuth | null;
  config: PilotConfig | null;
  hasAllSitesPermission: boolean;
  activeTab: TabInfo | null;
  runtimeConfig: RuntimeConfig | null;
  sending: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onGrantPermission: () => void;
  onRefreshPageContext: () => void;
  onOpenEmma: () => void;
}) {
  return (
    <div className="pilot-settings-view">
      <section className="pilot-settings-card">
        <div className="pilot-settings-card-header">
          <div>
            <p className="pilot-panel-title">Connection</p>
            <p className="pilot-panel-subtitle">
              Sign in and manage browser access.
            </p>
          </div>
          <span className={clsx("pilot-badge", props.auth ? "is-success" : "")}>
            {props.auth ? "Connected" : "Disconnected"}
          </span>
        </div>

        <div className="pilot-settings-row">
          <div>
            <p className="pilot-settings-label">Emma account</p>
            <p className="pilot-settings-value">
              {props.auth?.user?.name ||
                props.auth?.user?.email ||
                "Not connected"}
            </p>
          </div>
          {props.auth ? (
            <button
              className="pilot-secondary-button"
              onClick={props.onDisconnect}
              disabled={props.sending}
              type="button"
            >
              Disconnect
            </button>
          ) : (
            <button
              className="pilot-primary-button"
              onClick={props.onConnect}
              disabled={props.sending}
              type="button"
            >
              Connect
            </button>
          )}
        </div>

        <div className="pilot-settings-row">
          <div>
            <p className="pilot-settings-label">Site access</p>
            <p className="pilot-settings-value">
              {props.hasAllSitesPermission
                ? "All sites granted"
                : "Current tab access only"}
            </p>
          </div>
          <button
            className="pilot-secondary-button"
            onClick={props.onGrantPermission}
            disabled={props.sending}
            type="button"
          >
            <Shield className="size-4" />
            Grant all sites
          </button>
        </div>
      </section>

      <section className="pilot-settings-card">
        <div className="pilot-settings-card-header">
          <div>
            <p className="pilot-panel-title">Browser status</p>
            <p className="pilot-panel-subtitle">
              Extension version, active tab, and current page context.
            </p>
          </div>
          <button
            className="pilot-icon-button"
            onClick={props.onRefreshPageContext}
            title="Refresh page context"
            type="button"
          >
            <RefreshCcw className="size-4" />
          </button>
        </div>

        <div className="pilot-status-grid">
          <StatusTile
            icon={<Globe className="size-4" />}
            label="Browser"
            value={props.runtimeConfig?.browser || "Unknown"}
          />
          <StatusTile
            icon={<CheckCircle2 className="size-4" />}
            label="Version"
            value={props.runtimeConfig?.version || "0.0.0"}
          />
        </div>

        <div className="pilot-settings-row is-stacked">
          <div>
            <p className="pilot-settings-label">Active tab</p>
            <p className="pilot-settings-value">
              {props.activeTab?.title || "No active tab detected"}
            </p>
            <p className="pilot-settings-muted">
              {props.activeTab?.url || "Open a normal web page to inspect it."}
            </p>
          </div>
        </div>
      </section>

      <section className="pilot-settings-card">
        <div className="pilot-settings-card-header">
          <div>
            <p className="pilot-panel-title">Install / update</p>
            <p className="pilot-panel-subtitle">
              Download the latest Chrome or Edge package, extract it, then load
              the unpacked folder in your browser.
            </p>
          </div>
        </div>

        <div className="pilot-download-grid">
          <DownloadCard
            title="Chrome"
            href={props.config?.release.chrome.downloadUrl ?? null}
          />
          <DownloadCard
            title="Edge"
            href={props.config?.release.edge.downloadUrl ?? null}
          />
        </div>

        <ol className="pilot-install-steps">
          <li>Download the Chrome or Edge package.</li>
          <li>Extract the zip file on your computer.</li>
          <li>Open `chrome://extensions` or `edge://extensions`.</li>
          <li>Enable developer mode and choose `Load unpacked`.</li>
          <li>Select the extracted Emma Pilot folder.</li>
        </ol>

        <div className="pilot-settings-row">
          <div>
            <p className="pilot-settings-label">Emma web app</p>
            <p className="pilot-settings-muted">
              Open the main Emma app to continue the same thread on the web.
            </p>
          </div>
          <button
            className="pilot-secondary-button"
            onClick={props.onOpenEmma}
            type="button"
          >
            <ExternalLink className="size-4" />
            Open Emma
          </button>
        </div>
      </section>
    </div>
  );
}

function StatusTile(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="pilot-status-tile">
      <div className="pilot-status-icon">{props.icon}</div>
      <div>
        <p className="pilot-settings-label">{props.label}</p>
        <p className="pilot-settings-value capitalize">{props.value}</p>
      </div>
    </div>
  );
}

function DownloadCard(props: {
  title: string;
  href: string | null;
}) {
  return (
    <div className="pilot-download-card">
      <div>
        <p className="pilot-panel-title">{props.title}</p>
        <p className="pilot-panel-subtitle">
          Download the latest extension package.
        </p>
      </div>
      {props.href ? (
        <a
          className="pilot-primary-button pilot-download-button"
          href={props.href}
          download
        >
          <Download className="size-4" />
          Download
        </a>
      ) : (
        <span className="pilot-secondary-button is-disabled">Not ready</span>
      )}
    </div>
  );
}

function renderToolPreview(value: unknown) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function ReasoningCard(props: {
  text: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(props.isStreaming);

  useEffect(() => {
    if (props.isStreaming) {
      setExpanded(true);
    }
  }, [props.isStreaming]);

  return (
    <div className="pilot-process-card">
      <button
        className="pilot-process-toggle"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <span className="pilot-process-title">Thinking</span>
        <span className="pilot-badge">
          {props.isStreaming ? "Live" : "Reasoning"}
        </span>
      </button>
      {expanded ? (
        <div className="pilot-process-body">
          <div className="pilot-markdown">
            <PilotMarkdown>{props.text}</PilotMarkdown>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ProposalCard(props: {
  proposal: PilotProposal;
  result?: PilotActionResult;
  onApproveProposal: (proposal: PilotProposal) => void;
}) {
  return (
    <div className="pilot-proposal-card">
      <div className="pilot-proposal-header">
        <span className="pilot-proposal-title">{props.proposal.label}</span>
        <span
          className={clsx(
            "pilot-badge",
            props.result?.status === "succeeded" && "is-success",
          )}
        >
          {props.result
            ? props.result.status
            : props.proposal.requiresApproval
              ? props.proposal.isSensitive
                ? "Sensitive"
                : "Approval"
              : "Auto"}
        </span>
      </div>
      <div className="pilot-proposal-text pilot-markdown">
        <PilotMarkdown>{props.proposal.explanation}</PilotMarkdown>
      </div>
      <div className="pilot-proposal-footer">
        <span className="pilot-settings-muted">
          {props.result?.summary ||
            props.proposal.url ||
            props.proposal.elementId ||
            props.proposal.kind}
        </span>
        {props.proposal.requiresApproval ? (
          <button
            className="pilot-secondary-button"
            onClick={() => props.onApproveProposal(props.proposal)}
            disabled={Boolean(props.result)}
            type="button"
          >
            {props.result ? "Recorded" : "Approve"}
          </button>
        ) : (
          <span className="pilot-settings-muted">
            {props.result
              ? "Executed automatically"
              : "Executing automatically"}
          </span>
        )}
      </div>
    </div>
  );
}

function ToolPartCard(props: {
  part: any;
  actionResults: PilotActionResult[];
  onApproveProposal: (proposal: PilotProposal) => void;
  messageId?: string;
  itemIndex?: number;
}) {
  const toolName = getToolName(props.part);
  const proposal =
    toolName.startsWith("pilot_propose_") &&
    props.part.state === "output-available" &&
    props.part.output &&
    typeof props.part.output === "object"
      ? (props.part.output as PilotProposal)
      : null;

  if (proposal) {
    return (
      <ProposalCard
        proposal={proposal}
        result={props.actionResults.find(
          (item) => item.proposalId === proposal.id,
        )}
        onApproveProposal={props.onApproveProposal}
      />
    );
  }

  const outputMessage =
    props.part.state === "output-available" &&
    props.part.output &&
    typeof props.part.output === "object" &&
    "parts" in props.part.output
      ? (props.part.output as UIMessage)
      : null;
  const nestedText = outputMessage
    ? outputMessage.parts
        .filter(isTextPilotPart)
        .map((part) => part.text)
        .join("\n")
        .trim()
    : "";
  const nestedToolParts = outputMessage
    ? outputMessage.parts.filter(
        (part): part is ToolUIPart =>
          isToolUIPart(part) && !shouldHidePilotToolPart(part),
      )
    : [];

  return (
    <div className="pilot-process-card">
      <div className="pilot-process-toggle">
        <span className="pilot-process-title">{toolName}</span>
        <span className="pilot-badge">{getToolStateLabel(props.part)}</span>
      </div>

      <div className="pilot-process-body">
        {"input" in props.part && props.part.input ? (
          <pre className="pilot-tool-json">
            {renderToolPreview(props.part.input)}
          </pre>
        ) : null}

        {nestedToolParts.length ? (
          <div className="pilot-tool-steps">
            {nestedToolParts.map((part, index) => (
              <div
                key={getStableStreamItemKey({
                  messageId: outputMessage?.id,
                  preferredKey: part.toolCallId,
                  fallbackLabel: getToolName(part),
                  index,
                })}
                className="pilot-tool-step"
              >
                {getToolName(part)}
              </div>
            ))}
          </div>
        ) : null}

        {nestedText ? (
          <div className="pilot-markdown">
            <PilotMarkdown>{nestedText}</PilotMarkdown>
          </div>
        ) : null}

        {!nestedText && "output" in props.part && props.part.output ? (
          <pre className="pilot-tool-json">
            {renderToolPreview(props.part.output)}
          </pre>
        ) : null}

        {props.part.state === "output-error" ? (
          <p className="pilot-message-text is-muted">Tool execution failed.</p>
        ) : null}
      </div>
    </div>
  );
}

function MessageCard(props: {
  message: PilotMessage;
  isActive: boolean;
  isStreaming: boolean;
  actionResults: PilotActionResult[];
  onApproveProposal: (proposal: PilotProposal) => void;
}) {
  const visibleParts = props.message.parts.filter((part) => {
    if (!isToolUIPart(part)) {
      return true;
    }

    return !shouldHidePilotToolPart(part);
  });
  const fileParts = props.message.parts.filter((part) => isFilePilotPart(part));
  const sourceParts = props.message.parts.filter(
    (part) => part.type === "source-url",
  ) as Array<{
    type: "source-url";
    url: string;
    title?: string;
  }>;
  const streamedProposals = extractPilotProposalsFromMessage(props.message);
  const legacyProposals =
    streamedProposals.length === 0
      ? (props.message.metadata?.pilotProposals ?? [])
      : [];

  if (
    props.message.role !== "user" &&
    visibleParts.length === 0 &&
    fileParts.length === 0 &&
    sourceParts.length === 0 &&
    legacyProposals.length === 0
  ) {
    return null;
  }

  return (
    <article
      className={clsx(
        "pilot-message-card",
        props.message.role === "user" ? "is-user" : "is-assistant",
      )}
    >
      <div className="pilot-message-meta">
        <span>{props.message.role === "user" ? "You" : "Emma Pilot"}</span>
      </div>

      {visibleParts.map((part, index) => {
        if (isTextPilotPart(part)) {
          return (
            <div
              key={`${props.message.id}-text-${index}`}
              className="pilot-markdown pilot-message-text"
            >
              <PilotMarkdown>{part.text}</PilotMarkdown>
            </div>
          );
        }

        if (part.type === "reasoning") {
          return (
            <ReasoningCard
              key={`${props.message.id}-reasoning-${index}`}
              text={part.text}
              isStreaming={props.isStreaming && props.isActive}
            />
          );
        }

        if (isToolUIPart(part)) {
          return (
            <ToolPartCard
              key={getStableStreamItemKey({
                messageId: props.message.id,
                preferredKey: part.toolCallId,
                fallbackLabel: getToolName(part),
                index,
              })}
              part={part}
              actionResults={props.actionResults}
              onApproveProposal={props.onApproveProposal}
              messageId={props.message.id}
              itemIndex={index}
            />
          );
        }

        if (part.type === "step-start") {
          return null;
        }

        return null;
      })}

      {visibleParts.length === 0 ? (
        <p className="pilot-message-text is-muted">
          This message contains content that Emma Pilot does not render inline
          yet.
        </p>
      ) : null}

      {fileParts.length || sourceParts.length ? (
        <div className="pilot-message-assets">
          {fileParts.map((part, index) => (
            <a
              key={`${props.message.id}-file-${index}`}
              className="pilot-asset-pill"
              href={part.url}
              target="_blank"
              rel="noreferrer"
            >
              {part.filename || "File"}
            </a>
          ))}
          {sourceParts.map((part, index) => (
            <a
              key={`${props.message.id}-source-${index}`}
              className="pilot-asset-pill"
              href={part.url}
              target="_blank"
              rel="noreferrer"
            >
              {part.title || part.url}
            </a>
          ))}
        </div>
      ) : null}

      {legacyProposals.length ? (
        <div className="pilot-proposal-list">
          {legacyProposals.map((proposal, proposalIndex) => {
            const result = props.actionResults.find(
              (item) => item.proposalId === proposal.id,
            );

            return (
              <ProposalCard
                key={getStableStreamItemKey({
                  messageId: props.message.id,
                  preferredKey: proposal.id,
                  fallbackLabel: proposal.kind || proposal.label,
                  index: proposalIndex,
                })}
                proposal={proposal}
                result={result}
                onApproveProposal={props.onApproveProposal}
              />
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
