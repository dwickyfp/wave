import { describe, expect, it } from "vitest";
import {
  buildPilotModelProviders,
  resolveDefaultPilotChatModelFromProviders,
} from "./model-catalog";

describe("pilot model catalog", () => {
  it("keeps only enabled tool-capable llm models", () => {
    const providers = buildPilotModelProviders([
      {
        name: "openai",
        apiKeyMasked: "sk-***",
        models: [
          {
            enabled: true,
            uiName: "GPT-4.1",
            apiName: "gpt-4.1",
            contextLength: 128000,
            supportsGeneration: true,
            supportsTools: true,
            supportsImageInput: true,
            supportsFileInput: true,
            modelType: "llm",
          },
          {
            enabled: true,
            uiName: "No Tools",
            apiName: "no-tools",
            contextLength: 64000,
            supportsGeneration: true,
            supportsTools: false,
            supportsImageInput: false,
            supportsFileInput: false,
            modelType: "llm",
          },
          {
            enabled: true,
            uiName: "Image Gen",
            apiName: "image-gen",
            contextLength: 1,
            supportsGeneration: true,
            supportsTools: true,
            supportsImageInput: true,
            supportsFileInput: false,
            modelType: "image_generation",
          },
        ],
      },
    ]);

    expect(providers).toHaveLength(1);
    expect(providers[0]?.models).toEqual([
      expect.objectContaining({
        name: "GPT-4.1",
        isToolCallUnsupported: false,
      }),
    ]);
  });

  it("resolves the first available pilot model as default", () => {
    const model = resolveDefaultPilotChatModelFromProviders([
      {
        name: "anthropic",
        apiKeyMasked: "masked",
        models: [
          {
            enabled: true,
            uiName: "Claude Sonnet",
            apiName: "claude-sonnet",
            contextLength: 200000,
            supportsGeneration: true,
            supportsTools: true,
            supportsImageInput: true,
            supportsFileInput: true,
            modelType: "llm",
          },
        ],
      },
    ]);

    expect(model).toEqual({
      provider: "anthropic",
      model: "Claude Sonnet",
    });
  });

  it("prefers a provider with an API key for the default model", () => {
    const model = resolveDefaultPilotChatModelFromProviders([
      {
        name: "openai",
        apiKeyMasked: null,
        models: [
          {
            enabled: true,
            uiName: "GPT-4.1",
            apiName: "gpt-4.1",
            contextLength: 128000,
            supportsGeneration: true,
            supportsTools: true,
            supportsImageInput: true,
            supportsFileInput: true,
            modelType: "llm",
          },
        ],
      },
      {
        name: "anthropic",
        apiKeyMasked: "masked",
        models: [
          {
            enabled: true,
            uiName: "Claude Sonnet",
            apiName: "claude-sonnet",
            contextLength: 200000,
            supportsGeneration: true,
            supportsTools: true,
            supportsImageInput: true,
            supportsFileInput: true,
            modelType: "llm",
          },
        ],
      },
    ]);

    expect(model).toEqual({
      provider: "anthropic",
      model: "Claude Sonnet",
    });
  });
});
