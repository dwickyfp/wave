import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  knowledgeRepository: {
    getGroupsByAgentId: vi.fn(),
  },
  skillRepository: {
    getSkillsByAgentId: vi.fn(),
  },
  subAgentRepository: {
    selectSubAgentsByAgentId: vi.fn(),
  },
}));

vi.mock("@/app/api/chat/shared.chat", () => ({
  loadAppDefaultTools: vi.fn(async () => ({})),
  loadMcpTools: vi.fn(async () => ({
    owner_private_tool: {
      description: "owner private tool",
    },
  })),
  loadWorkFlowTools: vi.fn(async () => ({})),
  mergeSystemPrompt: vi.fn((...prompts: string[]) =>
    prompts.filter(Boolean).join("\n\n"),
  ),
}));

vi.mock("lib/ai/agent/subagent-loader", () => ({
  loadSubAgentTools: vi.fn(async () => ({
    subagent_owner_tool: {
      description: "subagent owner tool",
    },
  })),
}));

vi.mock("lib/ai/tools/knowledge-tool", () => ({
  createKnowledgeDocsTool: vi.fn((_group: unknown, options: unknown) => ({
    options,
  })),
  knowledgeDocsToolName: vi.fn((id: string) => `get_docs_${id}`),
}));

vi.mock("lib/ai/tools/skill-tool", () => ({
  LOAD_SKILL_TOOL_NAME: "load_skill",
  createLoadSkillTool: vi.fn(() => ({
    description: "load attached skill",
  })),
}));

vi.mock("lib/ai/prompts", () => ({
  buildActiveAgentSkillsSystemPrompt: vi.fn(() => ""),
  buildAgentSkillsSystemPrompt: vi.fn(() => ""),
  buildKnowledgeContextSystemPrompt: vi.fn(() => ""),
  buildMcpServerCustomizationsSystemPrompt: vi.fn(() => ""),
  buildParallelSubAgentSystemPrompt: vi.fn(() => ""),
  buildToolCallUnsupportedModelSystemPrompt: "",
  buildUserSystemPrompt: vi.fn(() => ""),
}));

const { knowledgeRepository, skillRepository, subAgentRepository } =
  await import("lib/db/repository");
const { loadMcpTools } = await import("@/app/api/chat/shared.chat");
const { loadSubAgentTools } = await import("lib/ai/agent/subagent-loader");
const { createKnowledgeDocsTool } = await import("lib/ai/tools/knowledge-tool");
const { createNoopDataStream, loadWaveAgentBoundTools } = await import(
  "./runtime"
);

describe("loadWaveAgentBoundTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(knowledgeRepository.getGroupsByAgentId).mockResolvedValue([
      {
        id: "knowledge-1",
        name: "Owner Knowledge",
        userId: "owner-1",
      },
    ] as any);
    vi.mocked(skillRepository.getSkillsByAgentId).mockResolvedValue([
      {
        id: "skill-1",
        title: "Owner Skill",
        instructions: "Use owner skill",
      },
    ] as any);
    vi.mocked(subAgentRepository.selectSubAgentsByAgentId).mockResolvedValue([
      {
        id: "subagent-1",
        name: "Planner",
        enabled: true,
        tools: [],
      },
    ] as any);
  });

  it("uses the shared agent owner as the capability source", async () => {
    const result = await loadWaveAgentBoundTools({
      agent: {
        id: "agent-1",
        userId: "owner-1",
        subAgentsEnabled: true,
        instructions: {
          mentions: [],
        },
      } as any,
      userId: "viewer-1",
      mentions: [],
      dataStream: createNoopDataStream(),
      abortSignal: new AbortController().signal,
      chatModel: {
        provider: "openai",
        model: "gpt-4.1-mini",
      } as any,
      source: "agent",
    });

    expect(vi.mocked(loadMcpTools)).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "viewer-1",
        additionalUserIds: ["owner-1"],
      }),
    );
    expect(vi.mocked(loadSubAgentTools)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent-1",
      }),
      "owner-1",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      [
        expect.objectContaining({
          title: "Owner Skill",
        }),
      ],
    );
    expect(vi.mocked(createKnowledgeDocsTool)).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "knowledge-1",
      }),
      expect.objectContaining({
        userId: "owner-1",
        source: "agent",
      }),
    );
    expect(result.mcpTools.owner_private_tool).toBeDefined();
    expect(result.subagentTools.subagent_owner_tool).toBeDefined();
    expect(result.skillTools.load_skill).toBeDefined();
  });
});
