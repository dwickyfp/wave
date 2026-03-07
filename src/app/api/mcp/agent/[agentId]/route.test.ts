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
  buildAgentSkillsSystemPrompt: vi.fn(() => ""),
  buildKnowledgeContextSystemPrompt: vi.fn(() => ""),
  buildMcpServerCustomizationsSystemPrompt: vi.fn(() => ""),
  buildParallelSubAgentSystemPrompt: vi.fn(() => ""),
  buildToolCallUnsupportedModelSystemPrompt: "unsupported",
  buildUserSystemPrompt: vi.fn(() => "base"),
}));

vi.mock("ai", () => ({
  streamText: vi.fn((options: any) => {
    void options?.onChunk?.({
      chunk: {
        type: "tool-call",
        toolName: "mock_tool",
        toolCallId: "tc-1",
        input: {},
      },
    });
    void options?.onChunk?.({
      chunk: {
        type: "tool-result",
        toolName: "mock_tool",
        toolCallId: "tc-1",
        output: {},
      },
    });
    void options?.onChunk?.({
      chunk: {
        type: "text-delta",
        id: "txt-1",
        text: "done",
      },
    });
    void options?.onStepFinish?.({});
    void options?.onFinish?.({});

    return {
      text: Promise.resolve("done"),
    };
  }),
  stepCountIs: vi.fn((n: number) => n),
}));

const { GET, POST } = await import("./route");
const { compare } = await import("bcrypt-ts");
const { streamText } = await import("ai");
const { getDbModel } = await import("lib/ai/provider-factory");
const {
  agentRepository,
  knowledgeRepository,
  settingsRepository,
  skillRepository,
  subAgentRepository,
  workflowRepository,
} = await import("lib/db/repository");

function withParams(agentId: string) {
  return {
    params: Promise.resolve({ agentId }),
  } as { params: Promise<{ agentId: string }> };
}

function makeNextRequest(url: string, init: RequestInit): Request {
  return Object.assign(new Request(url, init), {
    nextUrl: new URL(url),
  });
}

function authHeaders() {
  return {
    EMMA_AGENT_KEY: "my-key",
    "content-type": "application/json",
  };
}

describe("agent mcp route", () => {
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
      mcpPresentationMode: "compatibility",
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

  it("returns 401 when api key is missing", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns 401 when api key is invalid", async () => {
    vi.mocked(compare).mockResolvedValue(false as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns 403 when agent mcp is disabled", async () => {
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

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(403);
  });

  it("lists tool definitions", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.tools).toHaveLength(1);
    expect(json.result.tools[0].name).toBe("wave_run_agent");
  });

  it("lists dynamic copilot-native tools when presentation mode is enabled", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpPresentationMode: "copilot_native",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [
          {
            type: "workflow",
            workflowId: "workflow-1",
            name: "Create Issue",
          },
        ],
      },
      subAgentsEnabled: true,
    } as any);
    vi.mocked(subAgentRepository.selectSubAgentsByAgentId).mockResolvedValue([
      {
        id: "sa-planner",
        name: "Planner",
        description: "Plan work",
        tools: [],
        enabled: true,
      },
      {
        id: "sa-coder",
        name: "Coder",
        description: "Write code",
        tools: [],
        enabled: true,
      },
    ] as any);
    vi.mocked(knowledgeRepository.getGroupsByAgentId).mockResolvedValue([
      {
        id: "kg-1",
        name: "Product Docs",
        description: "Internal docs",
      },
    ] as any);
    vi.mocked(workflowRepository.selectToolByIds).mockResolvedValue([
      {
        id: "workflow-1",
        name: "Create Issue",
        description: "File a ticket",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
      },
    ] as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.tools.map((tool: any) => tool.name)).toEqual(
      expect.arrayContaining([
        "wave_run_agent",
        "wave_subagent_planner",
        "wave_subagent_coder",
        "wave_workflow_create_issue",
        "wave_knowledge_product_docs",
      ]),
    );
  });

  it("accepts x-emma-agent-key header alias", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: {
          "x-emma-agent-key": "my-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
  });

  it("accepts authorization bearer token", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: {
          authorization: "Bearer my-key",
          "content-type": "application/json",
        },
        body: JSON.stringify({ method: "tools/list", id: 1, jsonrpc: "2.0" }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
  });

  it("returns initialize payload", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "initialize",
          id: "init-1",
          jsonrpc: "2.0",
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.protocolVersion).toBe("2024-11-05");
    expect(json.result.serverInfo.name).toBe("wave-agent-agent-1");
  });

  it("returns method-not-found for unknown methods", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "nonexistent/method",
          id: 1,
          jsonrpc: "2.0",
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32601);
  });

  it("returns validation error for invalid wave_run_agent payload", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32602);
  });

  it("returns validation error for invalid files payload", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Update file",
              files: [
                {
                  path: "",
                  content: "x",
                },
              ],
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32602);
  });

  it("returns unknown tool error", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_unknown_tool",
            arguments: {},
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32601);
    expect(json.error.message).toContain("Unknown tool");
  });

  it("returns explicit model selection error when no model exists", async () => {
    vi.mocked(settingsRepository.getProviders).mockResolvedValue([]);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "hello",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain("No enabled tool-capable chat model");
  });

  it("executes wave_run_agent successfully", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Summarize this",
              messages: [
                {
                  role: "user",
                  content: "Prior context",
                },
              ],
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.content[0].text).toBe("done");
    expect(vi.mocked(streamText)).toHaveBeenCalledOnce();
  });

  it("supports file context + unified_diff response mode", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: "patch-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Update algorithm implementation",
              responseMode: "unified_diff",
              files: [
                {
                  path: "main.py",
                  language: "python",
                  content: "print('old')",
                },
              ],
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const callArgs = vi.mocked(streamText).mock.calls.at(-1)?.[0] as any;
    const lastMessage = callArgs.messages[callArgs.messages.length - 1];

    expect(callArgs.system).toContain("unified diff patch");
    expect(lastMessage.content).toContain("File: main.py");
    expect(lastMessage.content).toContain("print('old')");
  });

  it("executes a direct subagent tool in copilot-native mode", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpPresentationMode: "copilot_native",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: true,
    } as any);
    vi.mocked(subAgentRepository.selectSubAgentsByAgentId).mockResolvedValue([
      {
        id: "sa-planner",
        name: "Planner",
        description: "Plan work",
        instructions: "Plan carefully",
        tools: [],
        enabled: true,
      },
    ] as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: "subagent-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_subagent_planner",
            arguments: {
              task: "Plan this feature",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.content[0].text).toBe("done");
    const callArgs = vi.mocked(streamText).mock.calls.at(-1)?.[0] as any;
    expect(callArgs.system).toContain("Plan carefully");
  });

  it("executes a direct workflow tool in copilot-native mode", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpPresentationMode: "copilot_native",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [
          {
            type: "workflow",
            workflowId: "workflow-1",
            name: "Create Issue",
          },
        ],
      },
      subAgentsEnabled: false,
    } as any);
    vi.mocked(workflowRepository.selectToolByIds).mockResolvedValue([
      {
        id: "workflow-1",
        name: "Create Issue",
        description: "File a ticket",
        schema: {
          type: "object",
          properties: {
            title: { type: "string" },
          },
          required: ["title"],
        },
      },
    ] as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: "workflow-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_workflow_create_issue",
            arguments: {
              title: "Bug report",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.content[0].text).toContain(
      '"workflowName": "Create Issue"',
    );
    expect(json.result.content[0].text).toContain('"title": "Bug report"');
  });

  it("executes a direct knowledge tool in copilot-native mode", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpPresentationMode: "copilot_native",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: false,
    } as any);
    vi.mocked(knowledgeRepository.getGroupsByAgentId).mockResolvedValue([
      {
        id: "kg-1",
        name: "Product Docs",
        description: "Internal docs",
      },
    ] as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: "knowledge-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_knowledge_product_docs",
            arguments: {
              query: "deployment",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.content[0].text).toContain(
      "Knowledge result from Product Docs: deployment",
    );
  });

  it("supports streamable POST SSE with progress and final response", async () => {
    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: {
          ...authHeaders(),
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          method: "tools/call",
          id: "stream-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            _meta: {
              progressToken: "p-1",
            },
            arguments: {
              task: "Generate code",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const bodyText = await res.text();
    expect(bodyText).toContain('"method":"notifications/progress"');
    expect(bodyText).toContain('"progressToken":"p-1"');
    expect(bodyText).toContain('"id":"stream-1"');
    expect(bodyText).toContain('"result"');
  });

  it("aborts in-flight run when notifications/cancelled is received", async () => {
    vi.mocked(streamText).mockImplementationOnce(((options: any) => {
      return {
        text: new Promise<string>((_resolve, reject) => {
          options.abortSignal?.addEventListener(
            "abort",
            () => {
              const reason = options.abortSignal?.reason;
              reject(
                reason instanceof Error ? reason : new Error("client-cancel"),
              );
            },
            { once: true },
          );
        }),
      } as any;
    }) as any);

    const runningPromise = POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: "run-1",
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Long running task",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const cancelRes = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "notifications/cancelled",
          jsonrpc: "2.0",
          params: {
            requestId: "run-1",
            reason: "client-cancel",
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(cancelRes.status).toBe(202);

    const runningRes = await runningPromise;
    expect(runningRes.status).toBe(200);

    const runningJson = await runningRes.json();
    expect(runningJson.error.code).toBe(-32603);
    expect(runningJson.error.message).toContain("client-cancel");
  });

  it("supports legacy enabled tool-capable models without modelType", async () => {
    vi.mocked(settingsRepository.getProviders).mockResolvedValue([
      {
        name: "openai",
        models: [
          {
            enabled: true,
            supportsTools: true,
            uiName: "gpt-4.1-mini",
            apiName: "gpt-4.1-mini",
          },
        ],
      },
    ] as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Hello",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.content[0].text).toBe("done");
  });

  it("uses manually configured mcp model for agent", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpModelProvider: "openai",
      mcpModelName: "gpt-4.1-mini",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: false,
    } as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Hello",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    expect(vi.mocked(getDbModel)).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-4.1-mini",
    });
  });

  it("fails when manually configured mcp model is unavailable", async () => {
    vi.mocked(agentRepository.selectAgentByIdForMcp).mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      userId: "user-1",
      agentType: "standard",
      mcpEnabled: true,
      mcpModelProvider: "openai",
      mcpModelName: "missing-model",
      instructions: {
        role: "assistant",
        systemPrompt: "helpful",
        mentions: [],
      },
      subAgentsEnabled: false,
    } as any);

    const res = await POST(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          method: "tools/call",
          id: 1,
          jsonrpc: "2.0",
          params: {
            name: "wave_run_agent",
            arguments: {
              task: "Hello",
            },
          },
        }),
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error.code).toBe(-32603);
    expect(json.error.message).toContain("Configured MCP model is unavailable");
  });

  it("keeps legacy GET SSE support", async () => {
    const res = await GET(
      makeNextRequest("http://localhost/api/mcp/agent/agent-1", {
        method: "GET",
        headers: {
          ...authHeaders(),
          accept: "text/event-stream",
        },
      }) as any,
      withParams("agent-1"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: endpoint");
    await reader!.cancel();
  });
});
