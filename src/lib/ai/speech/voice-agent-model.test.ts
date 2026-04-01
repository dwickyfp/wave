import { describe, expect, it } from "vitest";
import { resolveVoiceAgentModelSelection } from "./voice-agent-model";

const providers = [
  {
    name: "openai",
    models: [
      {
        apiName: "gpt-4.1",
        uiName: "gpt-4.1",
        enabled: true,
        supportsTools: true,
        modelType: "llm",
      },
      {
        apiName: "gpt-4.1-mini",
        uiName: "gpt-4.1-mini",
        enabled: true,
        supportsTools: true,
        modelType: "llm",
      },
    ],
  },
  {
    name: "anthropic",
    models: [
      {
        apiName: "claude-sonnet",
        uiName: "claude-sonnet",
        enabled: true,
        supportsTools: true,
        modelType: "llm",
      },
    ],
  },
];

describe("resolveVoiceAgentModelSelection", () => {
  it("prefers the selected agent MCP model over the global default", () => {
    const model = resolveVoiceAgentModelSelection({
      agent: {
        agentType: "standard",
        mcpModelProvider: "anthropic",
        mcpModelName: "claude-sonnet",
      },
      defaultConfig: {
        provider: "openai",
        model: "gpt-4.1",
      },
      providers,
    });

    expect(model).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
    });
  });

  it("falls back to the default voice agent model when no agent MCP model is set", () => {
    const model = resolveVoiceAgentModelSelection({
      agent: {
        agentType: "standard",
        mcpModelProvider: null,
        mcpModelName: null,
      },
      defaultConfig: {
        provider: "openai",
        model: "gpt-4.1",
      },
      providers,
    });

    expect(model).toEqual({
      provider: "openai",
      model: "gpt-4.1",
    });
  });

  it("returns null for snowflake and A2A agents", () => {
    expect(
      resolveVoiceAgentModelSelection({
        agent: {
          agentType: "snowflake_cortex",
          mcpModelProvider: null,
          mcpModelName: null,
        },
        defaultConfig: null,
        providers,
      }),
    ).toBeNull();

    expect(
      resolveVoiceAgentModelSelection({
        agent: {
          agentType: "a2a_remote",
          mcpModelProvider: null,
          mcpModelName: null,
        },
        defaultConfig: null,
        providers,
      }),
    ).toBeNull();
  });

  it("throws when no default voice agent model is configured", () => {
    expect(() =>
      resolveVoiceAgentModelSelection({
        agent: {
          agentType: "standard",
          mcpModelProvider: null,
          mcpModelName: null,
        },
        defaultConfig: null,
        providers,
      }),
    ).toThrow(
      "Default Voice Agent Model is not configured. Set it in Emma Model Setup before starting voice chat.",
    );
  });

  it("throws when the configured agent MCP model is unavailable", () => {
    expect(() =>
      resolveVoiceAgentModelSelection({
        agent: {
          agentType: "standard",
          mcpModelProvider: "openai",
          mcpModelName: "missing-model",
        },
        defaultConfig: {
          provider: "openai",
          model: "gpt-4.1",
        },
        providers,
      }),
    ).toThrow(
      "Configured agent MCP model is unavailable or not tool-capable. Update this agent's MCP model selection before starting voice chat.",
    );
  });
});
