import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  embedManyMock,
  embedMock,
  createOpenAIMock,
  createOpenRouterMock,
  getProviderByNameMock,
} = vi.hoisted(() => ({
  embedManyMock: vi.fn(),
  embedMock: vi.fn(),
  createOpenAIMock: vi.fn(),
  createOpenRouterMock: vi.fn(),
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

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn(),
}));

vi.mock("@ai-sdk/cohere", () => ({
  createCohere: vi.fn(),
}));

vi.mock("ollama-ai-provider-v2", () => ({
  createOllama: vi.fn(),
}));

vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: createOpenRouterMock,
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
    delete process.env.KNOWLEDGE_EMBEDDING_RETRY_ATTEMPTS;
    delete process.env.KNOWLEDGE_EMBEDDING_RETRY_BASE_DELAY_MS;
    delete process.env.KNOWLEDGE_EMBEDDING_MAX_CONCURRENCY;
    getProviderByNameMock.mockResolvedValue({
      enabled: true,
      apiKey: "test-key",
      baseUrl: null,
      settings: {},
    });
    createOpenAIMock.mockImplementation(() => ({
      textEmbeddingModel: (modelName: string) => ({ modelName }),
    }));
    createOpenRouterMock.mockImplementation(() => ({
      textEmbeddingModel: (modelName: string) => ({ modelName }),
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

  it("retries batch embeddings when the provider returns a rate-limit error", async () => {
    process.env.KNOWLEDGE_EMBEDDING_RETRY_ATTEMPTS = "2";
    process.env.KNOWLEDGE_EMBEDDING_RETRY_BASE_DELAY_MS = "0";

    embedManyMock
      .mockRejectedValueOnce(
        new Error(
          "RateLimitReached: Please retry after 0 seconds before creating more embeddings.",
        ),
      )
      .mockResolvedValueOnce({
        embeddings: [[0.1, 0.2]],
        usage: { tokens: 9 },
      });

    const result = await embedTextsWithUsage(
      ["alpha"],
      "openai",
      "usage-batch-model",
    );

    expect(result.usageTokens).toBe(9);
    expect(result.embeddings).toEqual([[0.1, 0.2]]);
    expect(embedManyMock).toHaveBeenCalledTimes(2);
  });

  it("normalizes html whitespace artifacts before batch embedding", async () => {
    embedManyMock.mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      usage: { tokens: 5 },
    });

    await embedTextsWithUsage(
      ["PT BANK CENTRAL ASIA&nbsp;&nbsp;&nbsp;&nbsp;Tbk"],
      "openai",
      "usage-batch-model",
    );

    expect(embedManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        values: ["PT BANK CENTRAL ASIA Tbk"],
      }),
    );
  });

  it("retries openrouter upstream failures that report no successful provider responses", async () => {
    process.env.KNOWLEDGE_EMBEDDING_RETRY_ATTEMPTS = "2";
    process.env.KNOWLEDGE_EMBEDDING_RETRY_BASE_DELAY_MS = "0";

    embedManyMock
      .mockRejectedValueOnce(
        Object.assign(new Error("No successful provider responses."), {
          statusCode: 404,
        }),
      )
      .mockResolvedValueOnce({
        embeddings: [[0.6, 0.7]],
        usage: { tokens: 11 },
      });

    const result = await embedTextsWithUsage(
      ["alpha"],
      "openrouter",
      "openai/text-embedding-3-large",
    );

    expect(result.usageTokens).toBe(11);
    expect(result.embeddings).toEqual([[0.6, 0.7]]);
    expect(embedManyMock).toHaveBeenCalledTimes(2);
  });
});
