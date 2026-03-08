import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/ai/provider-factory", () => ({
  getDbModel: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  workflowRepository: {
    selectExecuteAbility: vi.fn(async () => []),
  },
}));

vi.mock("../../chat/shared.chat", () => ({
  loadAppDefaultTools: vi.fn(async () => ({})),
  loadMcpTools: vi.fn(async () => ({})),
}));

const { POST } = await import("./route");
const { getSession } = await import("auth/server");
const { getDbModel } = await import("lib/ai/provider-factory");

describe("agent generate route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue({
      user: { id: "user-1" },
    } as any);
  });

  it("rejects models without generate capability", async () => {
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

    const response = (await POST(
      new Request("http://localhost/api/agent/ai", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "create an agent",
          chatModel: { provider: "openai", model: "gpt-4.1-mini" },
        }),
      }),
    )) as Response;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("Generate Capabilities"),
    });
  });
});
