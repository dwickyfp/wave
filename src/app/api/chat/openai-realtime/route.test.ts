import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("../shared.chat", () => ({
  filterMcpServerCustomizations: vi.fn((_tools, customizations) => {
    return customizations;
  }),
  loadMcpTools: vi.fn(),
  mergeSystemPrompt: vi.fn((...parts: Array<string | undefined>) => {
    return parts.filter(Boolean).join("\n\n");
  }),
}));

vi.mock("lib/ai/prompts", () => ({
  buildMcpServerCustomizationsSystemPrompt: vi.fn(() => "mcp-customizations"),
  buildSpeechSystemPrompt: vi.fn(() => "speech-system"),
}));

vi.mock("lib/ai/agent/personalization", () => ({
  resolveAgentPersonalizationPrompt: vi.fn(() => "personalization"),
}));

vi.mock("../actions", () => ({
  rememberAgentAction: vi.fn(),
  rememberMcpServerCustomizationsAction: vi.fn(),
}));

vi.mock("lib/user/server", () => ({
  getUserPreferences: vi.fn(),
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
const { loadMcpTools } = await import("../shared.chat");
const { rememberAgentAction, rememberMcpServerCustomizationsAction } =
  await import("../actions");
const { getUserPreferences } = await import("lib/user/server");
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
    vi.mocked(rememberMcpServerCustomizationsAction).mockResolvedValue({});
    vi.mocked(loadMcpTools).mockResolvedValue({});
    vi.mocked(getUserPreferences).mockResolvedValue(null);
    vi.mocked(settingsRepository.getProviderByName).mockResolvedValue({
      apiKey: "provider-api-key",
    } as any);
  });

  it("configures GA realtime sessions for audio output", async () => {
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
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
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
    expect(gaBody.session.output_modalities).toEqual(["audio"]);
    expect(gaBody.session.audio.output).toEqual({
      voice: "ash",
      format: {
        type: "audio/pcm",
        rate: 24000,
      },
    });
    expect(gaBody.session.audio.input).toMatchObject({
      transcription: {
        model: "whisper-1",
      },
      turn_detection: {
        type: "server_vad",
        create_response: true,
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "ephemeral-token",
        expires_at: 1234,
      },
      pendingSessionUpdate: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: {
          output: {
            voice: "ash",
            format: {
              type: "audio/pcm",
              rate: 24000,
            },
          },
        },
      },
      websocketSessionUpdate: {
        audio: {
          input: {
            transcription: {
              model: "whisper-1",
            },
          },
        },
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
        body: JSON.stringify({}),
      }) as any,
    );

    expect(response.status).toBe(200);

    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "proxy",
        expires_at: 0,
      },
      pendingSessionUpdate: {
        modalities: ["text", "audio"],
        voice: "alloy",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: {
          model: "whisper-1",
        },
        turn_detection: {
          type: "server_vad",
          create_response: true,
        },
      },
      websocketSessionUpdate: {
        modalities: ["text", "audio"],
      },
    });
  });
});
