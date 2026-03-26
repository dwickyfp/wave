import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAzure, mockAzureModelFactory } = vi.hoisted(() => {
  const azureModelFactory = vi.fn((modelName: string) => ({
    provider: "azure",
    modelName,
  }));
  const createAzure = vi.fn(() => azureModelFactory);
  return {
    mockCreateAzure: createAzure,
    mockAzureModelFactory: azureModelFactory,
  };
});

const { mockCreateOpenAICompatible, mockOpenAICompatibleModelFactory } =
  vi.hoisted(() => {
    const openAICompatibleModelFactory = vi.fn((modelName: string) => ({
      provider: "openai-compatible",
      modelName,
    }));
    const createOpenAICompatible = vi.fn(() => openAICompatibleModelFactory);
    return {
      mockCreateOpenAICompatible: createOpenAICompatible,
      mockOpenAICompatibleModelFactory: openAICompatibleModelFactory,
    };
  });

vi.mock("server-only", () => ({}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: mockCreateAzure,
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

vi.mock("lib/db/repository", () => ({
  settingsRepository: {},
}));

import { createModelFromConfig } from "./provider-factory";

describe("createModelFromConfig - Azure OpenAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AZURE_API_KEY;
    delete process.env.AZURE_RESOURCE_NAME;
  });

  it("returns null when no Azure API key is available", () => {
    const model = createModelFromConfig("azure", "gpt-4.1");

    expect(model).toBeNull();
    expect(mockCreateAzure).not.toHaveBeenCalled();
  });

  it("uses resourceName when config value is not an HTTP URL", () => {
    const model = createModelFromConfig(
      "azure",
      "my-deployment",
      "azure-key",
      "my-resource",
    );

    expect(mockCreateAzure).toHaveBeenCalledWith({
      apiKey: "azure-key",
      resourceName: "my-resource",
    });
    expect(mockAzureModelFactory).toHaveBeenCalledWith("my-deployment");
    expect(model).toEqual({ provider: "azure", modelName: "my-deployment" });
  });

  it("uses baseURL when config value is an HTTP URL", () => {
    createModelFromConfig(
      "azure",
      "my-deployment",
      "azure-key",
      "https://my-resource.openai.azure.com/openai",
    );

    expect(mockCreateAzure).toHaveBeenCalledWith({
      apiKey: "azure-key",
      baseURL: "https://my-resource.openai.azure.com/openai",
    });
    expect(mockAzureModelFactory).toHaveBeenCalledWith("my-deployment");
  });

  it("uses provider settings for resourceName, apiVersion, and deployment URL mode", () => {
    createModelFromConfig("azure", "my-deployment", "azure-key", null, {
      resourceName: "my-resource-from-settings",
      apiVersion: "2025-04-01-preview",
      useDeploymentBasedUrls: true,
    });

    expect(mockCreateAzure).toHaveBeenCalledWith({
      apiKey: "azure-key",
      resourceName: "my-resource-from-settings",
      apiVersion: "2025-04-01-preview",
      useDeploymentBasedUrls: true,
    });
    expect(mockAzureModelFactory).toHaveBeenCalledWith("my-deployment");
  });

  it("falls back to AZURE_RESOURCE_NAME when base value is omitted", () => {
    process.env.AZURE_RESOURCE_NAME = "env-resource";

    createModelFromConfig("azure", "env-deployment", "azure-key");

    expect(mockCreateAzure).toHaveBeenCalledWith({
      apiKey: "azure-key",
      resourceName: "env-resource",
    });
    expect(mockAzureModelFactory).toHaveBeenCalledWith("env-deployment");
  });
});

describe("createModelFromConfig - Snowflake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SNOWFLAKE_API_KEY;
    delete process.env.SNOWFLAKE_ACCOUNT_ID;
  });

  it("enables structured outputs for Snowflake chat models", () => {
    const model = createModelFromConfig(
      "snowflake",
      "claude-sonnet-4-5",
      "snowflake-key",
      "acme-account",
    );

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith({
      name: "snowflake",
      apiKey: "snowflake-key",
      baseURL: "https://acme-account.snowflakecomputing.com/api/v2/cortex/v1",
      supportsStructuredOutputs: true,
      transformRequestBody: expect.any(Function),
    });
    expect(mockOpenAICompatibleModelFactory).toHaveBeenCalledWith(
      "claude-sonnet-4-5",
    );
    expect(model).toEqual({
      provider: "openai-compatible",
      modelName: "claude-sonnet-4-5",
    });
  });

  it("sanitizes Snowflake structured output schemas to the documented subset", () => {
    createModelFromConfig(
      "snowflake",
      "claude-sonnet-4-5",
      "snowflake-key",
      "acme-account",
    );

    const providerOptions = (mockCreateOpenAICompatible.mock.calls
      .at(0)
      ?.at(0) ?? null) as {
      transformRequestBody?: (
        args: Record<string, unknown>,
      ) => Record<string, unknown>;
    } | null;
    const transformRequestBody = providerOptions?.transformRequestBody as
      | ((args: Record<string, unknown>) => Record<string, unknown>)
      | undefined;

    expect(transformRequestBody).toBeTypeOf("function");

    const transformed = transformRequestBody?.({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          strict: true,
          description: "Structured output",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              ocrConfidence: {
                type: "number",
                minimum: 0,
                maximum: 1,
                additionalProperties: false,
                unevaluatedProperties: false,
              },
              tableData: {
                type: "object",
                additionalProperties: false,
                properties: {
                  rows: {
                    type: "array",
                    items: {
                      type: "array",
                      items: { type: "string", default: "" },
                    },
                  },
                },
              },
            },
            required: ["ocrConfidence"],
          },
        },
      },
    });

    expect(transformed).toEqual({
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          description: "Structured output",
          schema: {
            type: "object",
            properties: {
              ocrConfidence: {
                type: "number",
              },
              tableData: {
                type: "object",
                properties: {
                  rows: {
                    type: "array",
                    items: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
            required: ["ocrConfidence"],
          },
        },
      },
    });
  });
});
