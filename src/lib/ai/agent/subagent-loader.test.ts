import { beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.fn();

vi.mock("ai", () => ({
  ToolLoopAgent: class {
    stream = streamMock;
    constructor(_: unknown) {}
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
});
