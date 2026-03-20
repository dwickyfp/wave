import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  streamObject: vi.fn(),
}));

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/ai/provider-factory", () => ({
  getDbModel: vi.fn(),
}));

const { POST } = await import("./route");
const { streamObject } = await import("ai");
const { getSession } = await import("auth/server");
const { getDbModel } = await import("lib/ai/provider-factory");

describe("agent instruction enhance route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);

    const response = await POST(
      new Request("http://localhost/api/agent/instructions/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          changePrompt: "Add stricter validation rules.",
          currentInstructions: "Be helpful.",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("rejects models without generate capability", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(getDbModel).mockResolvedValue({
      model: {} as any,
      contextLength: 0,
      inputTokenPricePer1MUsd: 0,
      outputTokenPricePer1MUsd: 0,
      supportsTools: true,
      supportsGeneration: false,
      supportsImageInput: false,
      supportsFileInput: false,
    });

    const response = await POST(
      new Request("http://localhost/api/agent/instructions/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          changePrompt: "Add stricter validation rules.",
          currentInstructions: "Be helpful.",
          chatModel: { provider: "openai", model: "gpt-4.1-mini" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("Generate Capabilities"),
    });
  });

  it("streams the enhanced instructions payload", async () => {
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
    vi.mocked(getDbModel).mockResolvedValue({
      model: { id: "model-1" } as any,
      contextLength: 0,
      inputTokenPricePer1MUsd: 0,
      outputTokenPricePer1MUsd: 0,
      supportsTools: true,
      supportsGeneration: true,
      supportsImageInput: false,
      supportsFileInput: false,
    });
    vi.mocked(streamObject).mockReturnValue({
      toTextStreamResponse: () =>
        Response.json({ instructions: "Updated instructions" }),
    } as any);

    const response = await POST(
      new Request("http://localhost/api/agent/instructions/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          changePrompt: "Make responses more concise.",
          currentInstructions: "Answer in detail.",
          chatModel: { provider: "openai", model: "gpt-4.1-mini" },
          agentContext: {
            name: "Support Agent",
            role: "customer support",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      instructions: "Updated instructions",
    });
    expect(streamObject).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Make responses more concise."),
      }),
    );
  });
});
