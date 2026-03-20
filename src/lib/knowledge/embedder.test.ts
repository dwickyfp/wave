import { beforeEach, describe, expect, it, vi } from "vitest";

const { embedManyMock, embedMock, createOpenAIMock, getProviderByNameMock } =
  vi.hoisted(() => ({
    embedManyMock: vi.fn(),
    embedMock: vi.fn(),
    createOpenAIMock: vi.fn(),
    getProviderByNameMock: vi.fn(),
  }));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    embedMany: embedManyMock,
    embed: embedMock,
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: createOpenAIMock,
}));

vi.mock("@ai-sdk/cohere", () => ({
  createCohere: vi.fn(),
}));

vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getProviderByName: getProviderByNameMock,
  },
}));

const { embedSingleTextWithUsage, embedTextsWithUsage } = await import(
  "./embedder"
);

describe("embedder usage accounting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
    });
    createOpenAIMock.mockImplementation(() => ({
      embedding: (modelName: string) => ({ modelName }),
    }));
  });

  it("does not cache batch embeddings across calls", async () => {
    embedManyMock.mockResolvedValue({
      embeddings: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      usage: { tokens: 42 },
    });

    const first = await embedTextsWithUsage(
      ["alpha", "beta"],
      "openai",
      "usage-batch-model",
    );
    const second = await embedTextsWithUsage(
      ["alpha", "beta"],
      "openai",
      "usage-batch-model",
    );

    expect(first.usageTokens).toBe(42);
    expect(second.usageTokens).toBe(42);
    expect(embedManyMock).toHaveBeenCalledTimes(2);
  });

  it("returns zero usage for cached single-text embeddings", async () => {
    embedMock.mockResolvedValue({
      embedding: [0.9, 0.1],
      usage: { tokens: 7 },
    });

    const first = await embedSingleTextWithUsage(
      "gamma",
      "openai",
      "usage-single-model",
    );
    const second = await embedSingleTextWithUsage(
      "gamma",
      "openai",
      "usage-single-model",
    );

    expect(first.usageTokens).toBe(7);
    expect(second.usageTokens).toBe(0);
    expect(embedMock).toHaveBeenCalledTimes(1);
  });
});
