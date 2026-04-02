import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getProviderByName: vi.fn(),
  },
}));

const { getSession } = await import("auth/server");
const { settingsRepository } = await import("lib/db/repository");
const { POST } = await import("./route");

const fetchMock = vi.fn();

describe("voice tts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);

    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
  });

  it("calls the exact speech endpoint with the configured voice and text", async () => {
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue({
      apiKey: "openai-api-key",
      baseUrl: "https://api.openai.com/v1",
      enabled: true,
    } as any);
    fetchMock.mockResolvedValue(
      new Response("audio-data", {
        status: 200,
        headers: {
          "Content-Type": "audio/wav",
        },
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/chat/voice-tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Halo, saya Emma.",
          voice: "marin",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/audio/speech");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openai-api-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "Halo, saya Emma.",
      response_format: "wav",
    });
    expect(body.instructions).toContain(
      "Voice Affect: Calm, composed, and reassuring.",
    );
  });

  it("returns 503 when no OpenAI provider is configured for exact speech", async () => {
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/chat/voice-tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Halo, saya Emma.",
          voice: "marin",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error:
        "Exact voice playback requires an enabled OpenAI provider API key.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
