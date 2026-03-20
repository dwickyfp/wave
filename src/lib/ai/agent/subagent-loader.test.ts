import { beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.fn();
const toolLoopAgentConfigs: any[] = [];

vi.mock("server-only", () => ({}));

vi.mock("ai", () => ({
  ToolLoopAgent: class {
    stream = streamMock;
    constructor(settings: unknown) {
      toolLoopAgentConfigs.push(settings);
    }
  },
  tool: (config: unknown) => config,
  readUIMessageStream: ({ stream }: { stream: unknown }) => stream,
  stepCountIs: vi.fn((value: number) => value),
}));

vi.mock("lib/ai/provider-factory", () => ({
  getDbModel: vi.fn(async () => ({
    model: {},
    supportsTools: true,
    supportsImageInput: false,
    supportsFileInput: false,
  })),
}));

vi.mock("@/app/api/chat/shared.chat", () => ({
  loadMcpTools: vi.fn(async () => ({})),
  loadWorkFlowTools: vi.fn(async () => ({})),
  loadAppDefaultTools: vi.fn(async () => ({})),
}));

vi.mock("logger", () => ({
  default: {
    withDefaults: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("consola/utils", () => ({
  colorize: vi.fn((_color: string, value: string) => value),
}));

const { loadSubAgentTools } = await import("./subagent-loader");

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}

function makeMessageStream() {
  return (async function* () {
    yield {
      role: "assistant",
      parts: [{ type: "text", text: "done" }],
    } as any;
  })();
}

describe("loadSubAgentTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    toolLoopAgentConfigs.length = 0;
  });

  it("retries transient provider errors before succeeding", async () => {
    vi.useFakeTimers();
    streamMock
      .mockRejectedValueOnce({
        code: 500,
        message: JSON.stringify({
          type: "error.provider_unavailable",
          httpStatus: 502,
          message: "Service temporarily unavailable",
        }),
      })
      .mockResolvedValueOnce({
        toUIMessageStream: () => makeMessageStream(),
      });

    const tools = await loadSubAgentTools(
      {
        id: "agent-1",
        name: "Main Agent",
        userId: "user-1",
        instructions: {},
        subAgents: [
          {
            id: "sa-1",
            agentId: "agent-1",
            name: "Planner",
            instructions: "Plan tasks",
            tools: [],
            enabled: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      } as any,
      "user-1",
      { write() {}, merge() {} } as any,
      new AbortController().signal,
      { provider: "openai", model: "gpt-4.1-mini" },
      [],
    );

    const retryPromise = collect(
      (Object.values(tools)[0] as any).execute(
        { task: "Do the plan" },
        { abortSignal: new AbortController().signal },
      ),
    );

    await vi.runAllTimersAsync();
    const output = await retryPromise;

    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(output).toHaveLength(1);
    vi.useRealTimers();
  });

  it("does not retry non-transient errors", async () => {
    streamMock.mockRejectedValueOnce(new Error("Invalid prompt"));

    const tools = await loadSubAgentTools(
      {
        id: "agent-1",
        name: "Main Agent",
        userId: "user-1",
        instructions: {},
        subAgents: [
          {
            id: "sa-1",
            agentId: "agent-1",
            name: "Planner",
            instructions: "Plan tasks",
            tools: [],
            enabled: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      } as any,
      "user-1",
      { write() {}, merge() {} } as any,
      new AbortController().signal,
      { provider: "openai", model: "gpt-4.1-mini" },
      [],
    );

    await expect(
      collect(
        (Object.values(tools)[0] as any).execute(
          { task: "Do the plan" },
          { abortSignal: new AbortController().signal },
        ),
      ),
    ).rejects.toThrow("Invalid prompt");

    expect(streamMock).toHaveBeenCalledTimes(1);
  });

  it("activates only the relevant inherited skills per delegated task", async () => {
    streamMock.mockResolvedValue({
      toUIMessageStream: () => makeMessageStream(),
    });

    const tools = await loadSubAgentTools(
      {
        id: "agent-1",
        name: "Main Agent",
        userId: "user-1",
        instructions: {},
        subAgents: [
          {
            id: "sa-1",
            agentId: "agent-1",
            name: "Reviewer",
            instructions: "Review code carefully",
            tools: [],
            enabled: true,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      } as any,
      "user-1",
      { write() {}, merge() {} } as any,
      new AbortController().signal,
      { provider: "openai", model: "gpt-4.1-mini" },
      [
        {
          id: "skill-review",
          title: "Review Workflow",
          description: "Review pull requests with a checklist",
          instructions: "## Review\n- Check regressions\n- Check tests",
        },
        {
          id: "skill-rfc",
          title: "RFC Writer",
          description: "Draft technical RFCs",
          instructions: "## RFC\n- Gather context\n- Draft the document",
        },
      ],
    );

    const execute = (Object.values(tools)[0] as any).execute;

    await collect(
      execute(
        { task: "Review this pull request for regressions and tests." },
        { abortSignal: new AbortController().signal },
      ),
    );

    expect(toolLoopAgentConfigs.at(-1)?.instructions).toContain(
      "Review Workflow",
    );
    expect(toolLoopAgentConfigs.at(-1)?.instructions).not.toContain(
      "RFC Writer",
    );
    expect(toolLoopAgentConfigs.at(-1)?.tools.load_skill).toBeDefined();

    await collect(
      execute(
        { task: "Summarize the weather forecast." },
        { abortSignal: new AbortController().signal },
      ),
    );

    expect(toolLoopAgentConfigs.at(-1)?.instructions).not.toContain(
      "Review Workflow",
    );
  });
});
