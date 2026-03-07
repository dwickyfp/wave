import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcrypt-ts", () => ({
  compare: vi.fn(async () => true),
}));

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
    getDashboardStats: vi.fn(),
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
  workflowToVercelAITool: vi.fn(({ name }) => ({
    execute: vi.fn(async (input: any) => ({
      status: "success",
      result: {
        workflowName: name,
        input,
      },
    })),
  })),
}));

vi.mock("lib/ai/agent/subagent-loader", () => ({
  loadSubAgentTools: vi.fn(async () => ({})),
}));

vi.mock("lib/ai/tools/knowledge-tool", () => ({
  createKnowledgeDocsTool: vi.fn((group: { name: string }) => ({
    execute: vi.fn(
      async ({ query }: { query: string }) =>
        `Knowledge result from ${group.name}: ${query}`,
    ),
  })),
  knowledgeDocsToolName: vi.fn((id: string) => `get_docs_${id}`),
}));

vi.mock("lib/ai/tools/skill-tool", () => ({
  LOAD_SKILL_TOOL_NAME: "load_skill",
  createLoadSkillTool: vi.fn(() => ({})),
}));

vi.mock("lib/ai/prompts", () => ({
  buildAgentSkillsSystemPrompt: vi.fn(() => "skills"),
  buildKnowledgeContextSystemPrompt: vi.fn(() => ""),
  buildMcpServerCustomizationsSystemPrompt: vi.fn(() => ""),
  buildParallelSubAgentSystemPrompt: vi.fn(() => "parallel"),
  buildToolCallUnsupportedModelSystemPrompt: "unsupported",
  buildUserSystemPrompt: vi.fn(() => "base"),
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

vi.mock("ai", () => ({
  streamText: vi.fn((_options: any) => ({
    text: Promise.resolve("done"),
    toolCalls: Promise.resolve([]),
    finishReason: Promise.resolve("stop"),
    totalUsage: Promise.resolve({
      inputTokens: 12,
      outputTokens: 5,
      totalTokens: 17,
    }),
    fullStream: makeAsyncStream([
      { type: "text-delta", text: "done" },
      { type: "finish", finishReason: "stop" },
    ]),
  })),
  stepCountIs: vi.fn((n: number) => n),
  tool: vi.fn((definition: any) => definition),
  jsonSchema: vi.fn((schema: any) => schema),
}));

const { POST } = await import("./route");
const { GET: GET_MODELS } = await import("../../models/route");
const { compare } = await import("bcrypt-ts");
const { streamText } = await import("ai");
const { getDbModel } = await import("lib/ai/provider-factory");
const {
  agentRepository,
  agentAnalyticsRepository,
  knowledgeRepository,
  settingsRepository,
  skillRepository,
  subAgentRepository,
  workflowRepository,
} = await import("lib/db/repository");
const { loadMcpTools, loadAppDefaultTools, loadWorkFlowTools } = await import(
  "@/app/api/chat/shared.chat"
);

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

describe("agent continue/openai route", () => {
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
      supportsTools: true,
      supportsImageInput: false,
      supportsFileInput: false,
    });
    vi.mocked(knowledgeRepository.getGroupsByAgentId).mockResolvedValue([]);
    vi.mocked(skillRepository.getSkillsByAgentId).mockResolvedValue([]);
    vi.mocked(subAgentRepository.selectSubAgentsByAgentId).mockResolvedValue(
      [],
    );
    vi.mocked(workflowRepository.selectToolByIds).mockResolvedValue([]);
  });

  it("returns 401 when bearer key is missing", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(401);
  });

  it("returns 403 when external access is disabled", async () => {
    vi.mocked(agentRepository.getAgentByMcpKey).mockResolvedValue({
      id: "agent-1",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: false,
      mcpApiKeyHash: "hashed",
    } as any);
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      mcpEnabled: false,
      agentType: "standard",
    } as any);

    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(403);
  });

  it("returns a non-streaming chat completion for wave-managed chat", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one",
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.model).toBe("codex-agent_one");
    expect(json.choices[0].message.role).toBe("assistant");
    expect(json.choices[0].message.content).toBe("done");
    expect(vi.mocked(loadMcpTools)).toHaveBeenCalledOnce();
    expect(vi.mocked(loadWorkFlowTools)).toHaveBeenCalledOnce();
    expect(vi.mocked(loadAppDefaultTools)).toHaveBeenCalledOnce();
    expect(
      vi.mocked(agentAnalyticsRepository.recordContinueChatUsage),
    ).toHaveBeenCalledOnce();
  });

  it("returns tool calls and skips wave-managed tool loading when OpenAI tools are supplied", async () => {
    vi.mocked(streamText).mockImplementationOnce(((_options: any) => ({
      text: Promise.resolve(""),
      toolCalls: Promise.resolve([
        {
          toolCallId: "call-1",
          toolName: "read_file",
          input: { path: "main.py" },
        },
      ]),
      finishReason: Promise.resolve("tool-calls"),
      totalUsage: Promise.resolve({
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
      }),
      fullStream: makeAsyncStream([
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "read_file",
          input: { path: "main.py" },
        },
        { type: "finish", finishReason: "tool-calls" },
      ]),
    })) as any);

    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one",
            messages: [{ role: "user", content: "inspect the file" }],
            tools: [
              {
                type: "function",
                function: {
                  name: "read_file",
                  description: "Read a workspace file",
                  parameters: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                    },
                    required: ["path"],
                  },
                },
              },
            ],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices[0].finish_reason).toBe("tool_calls");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe(
      "read_file",
    );
    expect(vi.mocked(loadMcpTools)).not.toHaveBeenCalled();
    expect(
      vi.mocked(agentAnalyticsRepository.recordContinueChatUsage),
    ).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(streamText).mock.calls.at(-1)?.[0] as any;
    expect(callArgs.tools.read_file.description).toBe("Read a workspace file");
  });

  it("maps tool follow-up messages into model messages", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one",
            messages: [
              { role: "user", content: "read the file" },
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"main.py"}',
                    },
                  },
                ],
              },
              {
                role: "tool",
                tool_call_id: "call-1",
                content: "print('hello')",
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "read_file",
                  parameters: {
                    type: "object",
                    properties: {
                      path: { type: "string" },
                    },
                  },
                },
              },
            ],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const callArgs = vi.mocked(streamText).mock.calls.at(-1)?.[0] as any;
    expect(callArgs.messages[1]).toEqual({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "read_file",
          input: { path: "main.py" },
        },
      ],
    });
    expect(callArgs.messages[2]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read_file",
          output: {
            type: "text",
            value: "print('hello')",
          },
        },
      ],
    });
  });

  it("returns SSE chunks and [DONE] when stream=true", async () => {
    const res = (await POST(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/openai/v1/chat/completions",
        {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            model: "codex-agent_one",
            stream: true,
            messages: [{ role: "user", content: "hello" }],
          }),
        },
      ) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("chat.completion.chunk");
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain("[DONE]");
    expect(
      vi.mocked(agentAnalyticsRepository.recordContinueChatUsage),
    ).toHaveBeenCalledOnce();
  });

  it("lists a single per-agent model from /models", async () => {
    const res = (await GET_MODELS(
      makeNextRequest("http://localhost/api/agent/agent-1/openai/v1/models", {
        method: "GET",
        headers: {
          authorization: "Bearer test-key",
        },
      }) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.object).toBe("list");
    expect(json.data[0].id).toBe("codex-agent_one");
  });

  it("lists autocomplete model when configured", async () => {
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

    const res = (await GET_MODELS(
      makeNextRequest("http://localhost/api/agent/agent-1/openai/v1/models", {
        method: "GET",
        headers: {
          authorization: "Bearer test-key",
        },
      }) as any,
      withParams("agent-1"),
    )) as Response;

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[1].id).toBe("codex-agent_one_autocomplete");
  });
});
