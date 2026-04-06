import { OPENAI_REALTIME_URL } from "lib/ai/speech/open-ai/openai-realtime-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("auth/server", () => ({
  getSession: vi.fn(),
}));

vi.mock("../actions", () => ({
  rememberAgentAction: vi.fn(),
}));

vi.mock("lib/ai/agent/runtime", () => ({
  buildWaveAgentSystemPrompt: vi.fn(() => "native voice instructions"),
  createNoopDataStream: vi.fn(() => ({})),
  loadWaveAgentBoundTools: vi.fn(),
}));

vi.mock("lib/chat/chat-session", () => ({
  ensureUserChatThread: vi.fn(),
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
const { loadWaveAgentBoundTools } = await import("lib/ai/agent/runtime");
const { ensureUserChatThread } = await import("lib/chat/chat-session");
const { resolveVoiceAgentChatModel } = await import(
  "lib/ai/speech/voice-agent-model"
);
const { settingsRepository } = await import("lib/db/repository");
const { POST } = await import("./route");

const fetchMock = vi.fn();

const baseToolset = {
  mcpTools: {
    webSearch: {
      description: "Search the web",
      inputSchema: z.object({
        query: z.string(),
      }),
    },
  },
  workflowTools: {},
  appDefaultTools: {},
  subagentTools: {},
  knowledgeTools: {},
  skillTools: {},
  subAgents: [],
  knowledgeGroups: [],
  attachedSkills: [],
};

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
    } as any);
    vi.mocked(loadWaveAgentBoundTools).mockResolvedValue(baseToolset as any);
    vi.mocked(ensureUserChatThread).mockResolvedValue({
      id: "thread-1",
    } as any);
    vi.mocked(settingsRepository.getProviderByName).mockImplementation(
      async (name: string) => {
        if (name === "openai") {
          return {
            apiKey: "openai-provider-key",
          } as any;
        }

        if (name === "azure") {
          return {
            apiKey: "azure-provider-key",
          } as any;
        }

        return null;
      },
    );
  });

  it("returns a native realtime voice session for GA Azure deployments", async () => {
    vi.mocked(settingsRepository.getSetting).mockResolvedValue({
      baseUrl: "https://voice-resource.cognitiveservices.azure.com/",
      deploymentName: "gpt-realtime-1.5",
      apiVersion: "2025-04-01-preview",
      apiKey: "voice-api-key",
    } as any);
    fetchMock.mockResolvedValueOnce(
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
          threadId: "thread-1",
          transcriptionLanguage: "id-ID",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    expect(resolveVoiceAgentChatModel).toHaveBeenCalledOnce();
    expect(ensureUserChatThread).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        userId: "user-1",
      }),
    );

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

    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "ephemeral-token",
        expires_at: 1234,
      },
      voiceMode: "realtime_native",
      voicePolicy: {
        fillerDelayMs: 200,
        progressDelayMs: 1800,
        longProgressDelayMs: 4500,
        allowBargeIn: true,
        preferAudioReplies: true,
      },
      voiceTools: [
        expect.objectContaining({
          name: "webSearch",
          fillerKey: "search",
          source: "mcp",
        }),
      ],
      pendingSessionUpdate: {
        type: "realtime",
        instructions: "native voice instructions",
        tool_choice: "auto",
        tools: [
          expect.objectContaining({
            type: "function",
            name: "webSearch",
          }),
        ],
        audio: {
          input: {
            transcription: {
              language: "id",
              prompt: expect.stringContaining("bahasa indonesia"),
            },
            turn_detection: {
              create_response: true,
              interrupt_response: true,
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 550,
            },
          },
          output: {
            voice: "ash",
          },
        },
      },
      websocketSessionUpdate: {
        audio: {
          input: {
            turn_detection: {
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
  });

  it("falls back to direct OpenAI realtime when Azure voice is not configured", async () => {
    vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_secret: {
            value: "direct-openai-token",
            expires_at: 4321,
          },
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
          voice: "alloy",
          transcriptionLanguage: "en-US",
        }),
      }) as any,
    );

    expect(response.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENAI_REALTIME_URL);
    expect(init.headers).toMatchObject({
      Authorization: "Bearer openai-provider-key",
      "Content-Type": "application/json",
    });

    const requestBody = JSON.parse(String(init.body));
    expect(requestBody.model).toBe("gpt-realtime-1.5");
    expect(requestBody.audio.input.turn_detection.create_response).toBe(true);

    await expect(response.json()).resolves.toMatchObject({
      client_secret: {
        value: "direct-openai-token",
        expires_at: 4321,
      },
      voiceMode: "realtime_native",
      realtimeEndpointUrl: "https://api.openai.com/v1/realtime",
      sdpAuthHeader: "Authorization",
      model: "gpt-realtime-1.5",
      pendingSessionUpdate: {
        tool_choice: "auto",
        audio: {
          input: {
            turn_detection: {
              create_response: true,
              interrupt_response: true,
            },
          },
        },
      },
    });
  });

  it("falls back to the legacy Azure preview session shape when GA is unavailable and OpenAI fallback is disabled", async () => {
    vi.mocked(settingsRepository.getSetting).mockResolvedValue({
      baseUrl: "https://voice-resource.openai.azure.com",
      deploymentName: "my-realtime-preview",
      apiVersion: "2024-10-01-preview",
      apiKey: "voice-api-key",
    } as any);
    vi.mocked(settingsRepository.getProviderByName).mockImplementation(
      async (name: string) => {
        if (name === "azure") {
          return {
            apiKey: "azure-provider-key",
          } as any;
        }

        return null;
      },
    );
    fetchMock.mockResolvedValueOnce(
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
      voiceMode: "legacy",
      voiceTools: [],
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
          silence_duration_ms: 1200,
        },
      },
    });
  });
});
