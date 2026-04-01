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

vi.mock("lib/logger", () => ({
  default: {
    withDefaults: vi.fn(() => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

vi.mock("lib/db/repository", () => ({
  settingsRepository: {
    getSetting: vi.fn(),
    getProviderByName: vi.fn(),
  },
}));

const { getSession } = await import("auth/server");
const { rememberAgentAction } = await import("../actions");
const { resolveVoiceAgentChatModel } = await import(
  "lib/ai/speech/voice-agent-model"
);
const { settingsRepository } = await import("lib/db/repository");
const { POST } = await import("./route");

const fetchMock = vi.fn();

describe("openai realtime route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);

    vi.mocked(getSession).mockResolvedValue({
      user: {
        id: "user-1",
      },
    } as any);
    vi.mocked(rememberAgentAction).mockResolvedValue(undefined);
    vi.mocked(resolveVoiceAgentChatModel).mockResolvedValue({
      provider: "openai",
      model: "gpt-4.1",
    });
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue({
      apiKey: "provider-api-key",
    } as any);
  });

  it("configures GA realtime sessions for transport-only audio input/output", async () => {
    vi.mocked(settingsRepository.getSetting).mockResolvedValue({
      baseUrl: "https://voice-resource.cognitiveservices.azure.com/",
      deploymentName: "gpt-realtime-1.5",
      apiVersion: "2025-04-01-preview",
      apiKey: "voice-api-key",
    } as any);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "ephemeral-token",
          expires_at: 1234,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/chat/openai-realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice: "ash",
          transcriptionLanguage: "id-ID",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(resolveVoiceAgentChatModel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://voice-resource.openai.azure.com/openai/v1/realtime/client_secrets",
    );
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "api-key": "voice-api-key",
    });

    const gaBody = JSON.parse(String(init.body));
    expect(gaBody.session.model).toBe("gpt-realtime-1.5");
    expect(gaBody.session.audio.output).toEqual({
      voice: "ash",
    });
    expect(gaBody.session.output_modalities).toBeUndefined();
    expect(gaBody.session.audio.input).toBeUndefined();

    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "ephemeral-token",
        expires_at: 1234,
      },
      pendingSessionUpdate: {
        audio: {
          input: {
            transcription: {
              language: "id",
              prompt: expect.stringContaining("bahasa indonesia"),
            },
          },
        },
        instructions:
          "You are Emma's realtime voice transport. Transcribe the user's speech accurately. Do not create responses automatically. Only speak when the client explicitly asks you to generate audio output.",
      },
      websocketSessionUpdate: {
        audio: {
          input: {
            transcription: {
              language: "id",
              prompt: expect.stringContaining("bahasa indonesia"),
            },
          },
        },
        instructions:
          "You are Emma's realtime voice transport. Transcribe the user's speech accurately. Do not create responses automatically. Only speak when the client explicitly asks you to generate audio output.",
      },
    });
  });

  it("falls back to the legacy preview session shape when GA is unavailable", async () => {
    vi.mocked(settingsRepository.getSetting).mockResolvedValue({
      baseUrl: "https://voice-resource.openai.azure.com",
      deploymentName: "my-realtime-preview",
      apiVersion: "2024-10-01-preview",
      apiKey: "voice-api-key",
    } as any);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "OperationNotSupported",
            message: "not supported",
          },
        }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const response = await POST(
      new Request("http://localhost/api/chat/openai-realtime", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          voice: "ash",
          transcriptionLanguage: "id-ID",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "proxy",
      },
      proxySdpUrl:
        "/api/chat/openai-realtime-sdp?endpoint=https%3A%2F%2Fvoice-resource.openai.azure.com%2Fopenai%2Frealtime%3Fapi-version%3D2024-10-01-preview%26deployment%3Dmy-realtime-preview",
      pendingSessionUpdate: {
        input_audio_transcription: {
          language: "id",
          prompt: expect.stringContaining("bahasa indonesia"),
        },
        turn_detection: {
          create_response: false,
          interrupt_response: false,
        },
      },
    });
  });
});
