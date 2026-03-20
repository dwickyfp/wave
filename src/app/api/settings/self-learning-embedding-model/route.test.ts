import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../admin/evaluation/shared", () => ({
  requireAdminSession: vi.fn(),
}));

vi.mock("lib/self-learning/service", () => ({
  getSelfLearningEmbeddingModelConfig: vi.fn(),
  setSelfLearningEmbeddingModelConfig: vi.fn(),
}));

const { requireAdminSession } = await import("../../admin/evaluation/shared");
const {
  getSelfLearningEmbeddingModelConfig,
  setSelfLearningEmbeddingModelConfig,
} = await import("lib/self-learning/service");
const { GET, PUT } = await import("./route");

describe("self-learning embedding model settings route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminSession).mockResolvedValue({
      session: {
        user: {
          id: "admin-1",
          role: "admin",
        },
      },
    } as any);
  });

  it("returns the configured embedding model", async () => {
    vi.mocked(getSelfLearningEmbeddingModelConfig).mockResolvedValue({
      provider: "openai",
      model: "text-embedding-3-small",
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: "openai",
      model: "text-embedding-3-small",
    });
  });

  it("updates the configured embedding model", async () => {
    const response = await PUT(
      new Request(
        "http://localhost/api/settings/self-learning-embedding-model",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: "openai",
            model: "text-embedding-3-large",
          }),
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(setSelfLearningEmbeddingModelConfig).toHaveBeenCalledWith({
      provider: "openai",
      model: "text-embedding-3-large",
    });
  });
});
