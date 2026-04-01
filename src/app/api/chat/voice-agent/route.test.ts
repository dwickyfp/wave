import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("../actions", () => ({
  rememberAgentAction: vi.fn(),
}));

vi.mock("lib/ai/speech/voice-agent-model", () => ({
  resolveVoiceAgentChatModel: vi.fn(),
}));

const { getSession } = await import("auth/server");
const { rememberAgentAction } = await import("../actions");
const { resolveVoiceAgentChatModel } = await import(
  "lib/ai/speech/voice-agent-model"
);
const { POST } = await import("./route");

const fetchMock = vi.fn();

describe("voice agent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
  });

  it("prepends the selected agent mention and injects the resolved model", async () => {
    vi.mocked(rememberAgentAction).mockResolvedValue({
      id: "agent-1",
      name: "Planner",
      description: "Planning agent",
      icon: {
        type: "emoji",
        value: "P",
      },
      instructions: {
        mentions: [],
      },
    } as any);
    vi.mocked(resolveVoiceAgentChatModel).mockResolvedValue({
      provider: "openai",
      model: "gpt-4.1",
    });
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const response = await POST(
      new Request("http://localhost/api/chat/voice-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: "session=abc",
        },
        body: JSON.stringify({
          id: "thread-1",
          message: {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
          agentId: "agent-1",
          mentions: [
            {
              type: "mcpTool",
              name: "search",
              serverId: "server-1",
            },
          ],
          responseLanguageHint: "id",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("http://localhost/api/chat");
    expect(init?.headers).toMatchObject({
      "Content-Type": "application/json",
      cookie: "session=abc",
    });

    const body = JSON.parse(String(init?.body));
    expect(body.chatModel).toEqual({
      provider: "openai",
      model: "gpt-4.1",
    });
    expect(body.responseMode).toBe("voice");
    expect(body.responseLanguageHint).toBe("id");
    expect(body.toolChoice).toBe("auto");
    expect(body.mentions[0]).toMatchObject({
      type: "agent",
      agentId: "agent-1",
      name: "Planner",
    });
    expect(body.mentions[1]).toMatchObject({
      type: "mcpTool",
      name: "search",
    });
  });

  it("omits chatModel for snowflake or A2A agents", async () => {
    vi.mocked(rememberAgentAction).mockResolvedValue({
      id: "agent-2",
      name: "Snow",
      instructions: {
        mentions: [],
      },
    } as any);
    vi.mocked(resolveVoiceAgentChatModel).mockResolvedValue(null);
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    await POST(
      new Request("http://localhost/api/chat/voice-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "thread-2",
          message: {
            id: "message-2",
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          },
          agentId: "agent-2",
        }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(init?.body));
    expect(body.chatModel).toBeUndefined();
    expect(body.responseMode).toBe("voice");
  });

  it("forwards allowed tool configuration for agentless voice turns", async () => {
    vi.mocked(rememberAgentAction).mockResolvedValue(undefined);
    vi.mocked(resolveVoiceAgentChatModel).mockResolvedValue({
      provider: "openai",
      model: "gpt-4.1",
    });
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    await POST(
      new Request("http://localhost/api/chat/voice-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: "thread-3",
          message: {
            id: "message-3",
            role: "user",
            parts: [{ type: "text", text: "build a chart" }],
          },
          allowedAppDefaultToolkit: ["visualization", "code"],
          allowedMcpServers: {
            "server-1": {
              tools: ["search"],
            },
          },
        }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const body = JSON.parse(String(init?.body));

    expect(body.allowedAppDefaultToolkit).toEqual(["visualization", "code"]);
    expect(body.allowedMcpServers).toEqual({
      "server-1": {
        tools: ["search"],
      },
    });
    expect(body.responseMode).toBe("voice");
    expect(body.mentions).toEqual([]);
  });
});
