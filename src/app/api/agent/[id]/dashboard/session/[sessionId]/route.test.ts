import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    selectAgentById: vi.fn(),
  },
  agentAnalyticsRepository: {
    getExternalChatSessionDetail: vi.fn(),
  },
  chatRepository: {
    selectThreadDetails: vi.fn(),
  },
}));

const { GET } = await import("./route");
const { getSession } = await import("auth/server");
const { agentRepository, agentAnalyticsRepository, chatRepository } =
  await import("lib/db/repository");

function withParams(id: string, sessionId: string) {
  return {
    params: Promise.resolve({ id, sessionId }),
  } as { params: Promise<{ id: string; sessionId: string }> };
}

function makeNextRequest(url: string) {
  return Object.assign(new Request(url), {
    nextUrl: new URL(url),
  });
}

describe("agent dashboard session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({ user: { id: "u1" } } as any);
    vi.mocked(agentRepository.selectAgentById).mockResolvedValue({
      id: "agent-1",
      userId: "u1",
      agentType: "standard",
    } as any);
  });

  it("returns 401 when session is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    const res = await GET(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/dashboard/session/s1?source=in_app",
      ) as any,
      withParams("agent-1", "s1"),
    );

    expect(res.status).toBe(401);
  });

  it("returns in-app thread history for matching agent sessions", async () => {
    vi.mocked(chatRepository.selectThreadDetails).mockResolvedValue({
      id: "thread-1",
      title: "Python session",
      userId: "u1",
      createdAt: new Date("2026-03-07T00:00:00.000Z"),
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "Write main.py" }],
          createdAt: new Date("2026-03-07T00:00:01.000Z"),
        },
        {
          id: "m2",
          role: "assistant",
          parts: [{ type: "text", text: "Here is a plan" }],
          metadata: {
            agentId: "agent-1",
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          },
          createdAt: new Date("2026-03-07T00:00:02.000Z"),
        },
      ],
    } as any);

    const res = await GET(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/dashboard/session/thread-1?source=in_app",
      ) as any,
      withParams("agent-1", "thread-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toBe("in_app");
    expect(json.title).toBe("Python session");
    expect(json.messages).toHaveLength(2);
    expect(json.totalTokens).toBe(15);
  });

  it("returns external session detail from analytics repository", async () => {
    vi.mocked(
      agentAnalyticsRepository.getExternalChatSessionDetail,
    ).mockResolvedValue({
      source: "external_chat",
      sessionId: "ext-1",
      title: "Review main.py",
      summary: "Review main.py",
      transcriptMode: "full",
      totalTurns: 2,
      totalTokens: 42,
      promptTokens: 20,
      completionTokens: 22,
      status: "success",
      modelProvider: "openai",
      modelName: "gpt-4.1-mini",
      createdAt: "2026-03-07T00:00:00.000Z",
      updatedAt: "2026-03-07T00:01:00.000Z",
      messages: [
        {
          id: "request-1",
          role: "user",
          parts: [{ type: "text", text: "Review main.py" }],
        },
      ],
    } as any);

    const res = await GET(
      makeNextRequest(
        "http://localhost/api/agent/agent-1/dashboard/session/ext-1?source=external_chat",
      ) as any,
      withParams("agent-1", "ext-1"),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.source).toBe("external_chat");
    expect(json.totalTokens).toBe(42);
    expect(
      vi.mocked(agentAnalyticsRepository.getExternalChatSessionDetail),
    ).toHaveBeenCalledWith("agent-1", "ext-1");
  });
});
