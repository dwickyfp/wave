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
}));

vi.mock("lib/ai/agent/subagent-loader", () => ({
  loadSubAgentTools: vi.fn(async () => ({})),
}));

vi.mock("lib/ai/tools/knowledge-tool", () => ({
  createKnowledgeDocsTool: vi.fn(() => ({})),
  knowledgeDocsToolName: vi.fn((id: string) => `get_docs_${id}`),
}));

vi.mock("lib/ai/tools/skill-tool", () => ({
  LOAD_SKILL_TOOL_NAME: "load_skill",
  createLoadSkillTool: vi.fn(() => ({})),
}));

vi.mock("lib/ai/prompts", () => ({
  buildAgentSkillsSystemPrompt: vi.fn(() => ""),
  buildParallelSubAgentSystemPrompt: vi.fn(() => ""),
  buildUserSystemPrompt: vi.fn(() => "base"),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ text: "done" })),
  stepCountIs: vi.fn((n: number) => n),
}));

const { POST } = await import("./route");
const { compare } = await import("bcrypt-ts");
const { generateText } = await import("ai");
const { getDbModel } = await import("lib/ai/provider-factory");
const {
  agentRepository,
  knowledgeRepository,
  settingsRepository,
  skillRepository,
  subAgentRepository,
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
    expect(vi.mocked(generateText)).toHaveBeenCalledOnce();
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
});
