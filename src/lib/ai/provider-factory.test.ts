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

vi.mock("server-only", () => ({}));

vi.mock("@ai-sdk/azure", () => ({
  createAzure: mockCreateAzure,
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
