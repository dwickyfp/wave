import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcrypt-ts", () => ({
  compare: vi.fn(async () => true),
}));

function makeAsyncStream(parts: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    getAgentByMcpKey: vi.fn(),
    selectAgentByIdForMcp: vi.fn(),
  },
  knowledgeRepository: {
    getGroupsByAgentId: vi.fn(),
  },
  settingsRepository: {
    getProviders: vi.fn(),
  },
  skillRepository: {
    getSkillsByAgentId: vi.fn(),
  },
  subAgentRepository: {
    selectSubAgentsByAgentId: vi.fn(),
  },
  workflowRepository: {
    selectToolByIds: vi.fn(),
  },
  agentAnalyticsRepository: {
    recordContinueChatUsage: vi.fn(),
    recordContinueAutocompleteUsage: vi.fn(),
  },
}));

vi.mock("lib/ai/provider-factory", () => ({
  getDbModel: vi.fn(),
}));

vi.mock("@/app/api/chat/shared.chat", () => ({
  loadAppDefaultTools: vi.fn(async () => ({})),
  loadMcpTools: vi.fn(async () => ({})),
  loadWorkFlowTools: vi.fn(async () => ({})),
  mergeSystemPrompt: vi.fn((...prompts: string[]) =>
    prompts.filter(Boolean).join("\n\n"),
  ),
  workflowToVercelAITool: vi.fn(),
}));

vi.mock("lib/ai/agent/subagent-loader", () => ({
  loadSubAgentTools: vi.fn(async () => ({})),
}));

vi.mock("lib/ai/tools/knowledge-tool", () => ({
  createKnowledgeDocsTool: vi.fn(),
  knowledgeDocsToolName: vi.fn((id: string) => `get_docs_${id}`),
}));

vi.mock("lib/ai/tools/skill-tool", () => ({
  LOAD_SKILL_TOOL_NAME: "load_skill",
  createLoadSkillTool: vi.fn(() => ({})),
}));

vi.mock("lib/ai/prompts", () => ({
  buildActiveAgentSkillsSystemPrompt: vi.fn(() => ""),
  buildAgentSkillsSystemPrompt: vi.fn(() => "skills"),
  buildKnowledgeContextSystemPrompt: vi.fn(() => ""),
  buildMcpServerCustomizationsSystemPrompt: vi.fn(() => ""),
  buildParallelSubAgentSystemPrompt: vi.fn(() => "parallel"),
  buildToolCallUnsupportedModelSystemPrompt: "unsupported",
  buildUserSystemPrompt: vi.fn(() => "base"),
}));

vi.mock("lib/self-learning/runtime", () => ({
  getLearnedPersonalizationPromptForUser: vi.fn(async () => "learned prompt"),
}));

vi.mock("ai", () => ({
  streamText: vi.fn((_options: any) => ({
    text: Promise.resolve("def add(a, b):\n    return a + b\n"),
    toolCalls: Promise.resolve([]),
    finishReason: Promise.resolve("stop"),
    totalUsage: Promise.resolve({
      inputTokens: 8,
      outputTokens: 4,
      totalTokens: 12,
    }),
    fullStream: makeAsyncStream([
      { type: "text-delta", text: "def add(a, b):\n" },
      { type: "text-delta", text: "    return a + b\n" },
      { type: "finish", finishReason: "stop" },
    ]),
  })),
  stepCountIs: vi.fn((n: number) => n),
  tool: vi.fn((definition: any) => definition),
  jsonSchema: vi.fn((schema: any) => schema),
}));

const { POST } = await import("./route");
const { compare } = await import("bcrypt-ts");
const { getDbModel } = await import("lib/ai/provider-factory");
const { getLearnedPersonalizationPromptForUser } = await import(
  "lib/self-learning/runtime"
);
const { agentRepository, agentAnalyticsRepository, settingsRepository } =
  await import("lib/db/repository");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as { params: Promise<{ id: string }> };
}

function makeNextRequest(url: string, init: RequestInit): Request {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  });
}

function authHeaders() {
  return {
    authorization: "Bearer test-key",
    "content-type": "application/json",
  };
}

describe("agent continue/openai completions route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(compare).mockResolvedValue(true as any);
    vi.mocked(agentRepository.getAgentByMcpKey).mockResolvedValue({
      id: "agent-1",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpApiKeyHash: "hashed",
    } as any);
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpAutocompleteModelProvider: "openai",
      mcpAutocompleteModelName: "gpt-4.1-mini",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: false,
    } as any);
    vi.mocked(settingsRepository.getProviders).mockResolvedValue([
      {
        name: "openai",
        models: [
          {
            enabled: true,
            supportsTools: true,
            modelType: "llm",
            uiName: "gpt-4.1-mini",
            apiName: "gpt-4.1-mini",
          },
        ],
      },
    ] as any);
    vi.mocked(getDbModel).mockResolvedValue({
      model: {} as any,
      contextLength: 0,
      inputTokenPricePer1MUsd: 0,
      outputTokenPricePer1MUsd: 0,
      supportsTools: true,
      supportsGeneration: true,
      supportsImageInput: false,
      supportsFileInput: false,
    });
  });

  it("returns 400 when autocomplete model is not configured", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: false,
    } as any);

    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one_autocomplete",
            prompt: "def add(a, b):\n    ",
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(400);
  });

  it("returns non-streaming legacy completion output", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one_autocomplete",
            prompt: "def add(a, b):\n    ",
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("text_completion");
    expect(json.choices[0].text).toContain("return a + b");
    expect(
      vi.mocked(agentAnalyticsRepository.recordContinueAutocompleteUsage),
    ).toHaveBeenCalledOnce();
  });

  it("returns SSE stream output for autocomplete", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one_autocomplete",
            stream: true,
            prompt: "def add(a, b):\n    ",
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("text_completion");
    expect(text).toContain("[DONE]");
    expect(
      vi.mocked(agentAnalyticsRepository.recordContinueAutocompleteUsage),
    ).toHaveBeenCalledOnce();
  });

  it("does not load learned personalization for continue autocomplete", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one_autocomplete",
            prompt: "def add(a, b):\n    ",
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    expect(getLearnedPersonalizationPromptForUser).not.toHaveBeenCalled();
  });
});
