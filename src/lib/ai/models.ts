import "server-only";

import { openrouter } from "@openrouter/ai-sdk-provider";
import { LanguageModel } from "ai";
import {
  createOpenAICompatibleModels,
  openaiCompatibleModelsSafeParse,
} from "./create-openai-compatiable";
import { ChatModel } from "app-types/chat";
import {
  DEFAULT_FILE_PART_MIME_TYPES,
  OPENAI_FILE_MIME_TYPES,
  GEMINI_FILE_MIME_TYPES,
  ANTHROPIC_FILE_MIME_TYPES,
  XAI_FILE_MIME_TYPES,
} from "./file-support";

const staticModels = {
  openai: {
    "gpt-4.1": openrouter("openai/gpt-4.1"),
    "gpt-4.1-mini": openrouter("openai/gpt-4.1-mini"),
    "o4-mini": openrouter("openai/o4-mini"),
    o3: openrouter("openai/o3"),
    "gpt-5.1-chat": openrouter("openai/gpt-5.1-chat-latest"),
    "gpt-5.1": openrouter("openai/gpt-5.1"),
    "gpt-5.1-codex": openrouter("openai/gpt-5.1-codex"),
    "gpt-5.1-codex-mini": openrouter("openai/gpt-5.1-codex-mini"),
  },
  google: {
    "gemini-2.5-flash-lite": openrouter("google/gemini-2.5-flash-lite"),
    "gemini-2.5-flash": openrouter("google/gemini-2.5-flash"),
    "gemini-3-pro": openrouter("google/gemini-3-pro-preview"),
    "gemini-2.5-pro": openrouter("google/gemini-2.5-pro"),
  },
  anthropic: {
    "sonnet-4.5": openrouter("anthropic/claude-sonnet-4-5"),
    "haiku-4.5": openrouter("anthropic/claude-haiku-4-5"),
    "opus-4.5": openrouter("anthropic/claude-opus-4-5"),
  },
  xai: {
    "grok-4-1-fast": openrouter("x-ai/grok-4-1-fast"),
    "grok-4-1": openrouter("x-ai/grok-4-1"),
    "grok-3-mini": openrouter("x-ai/grok-3-mini"),
  },
  ollama: {
    "gemma3:1b": openrouter("google/gemma-3-1b-it"),
    "gemma3:4b": openrouter("google/gemma-3-4b-it"),
    "gemma3:12b": openrouter("google/gemma-3-12b-it"),
  },
  groq: {
    "kimi-k2-instruct": openrouter("moonshotai/kimi-k2"),
    "llama-4-scout-17b": openrouter(
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ),
    "gpt-oss-20b": openrouter("openai/gpt-oss-20b"),
    "gpt-oss-120b": openrouter("openai/gpt-oss-120b"),
    "qwen3-32b": openrouter("qwen/qwen3-32b"),
  },
  openRouter: {
    "gpt-oss-20b:free": openrouter("openai/gpt-oss-20b:free"),
    "qwen3-8b:free": openrouter("qwen/qwen3-8b:free"),
    "qwen3-14b:free": openrouter("qwen/qwen3-14b:free"),
    "qwen3-coder:free": openrouter("qwen/qwen3-coder:free"),
    "deepseek-r1:free": openrouter("deepseek/deepseek-r1-0528:free"),
    "deepseek-v3:free": openrouter("deepseek/deepseek-chat-v3-0324:free"),
    "gemini-2.0-flash-exp:free": openrouter("google/gemini-2.0-flash-exp:free"),
  },
};

const staticUnsupportedModels = new Set([
  staticModels.openai["o4-mini"],
  staticModels.ollama["gemma3:1b"],
  staticModels.ollama["gemma3:4b"],
  staticModels.ollama["gemma3:12b"],
  staticModels.openRouter["gpt-oss-20b:free"],
  staticModels.openRouter["qwen3-8b:free"],
  staticModels.openRouter["qwen3-14b:free"],
  staticModels.openRouter["deepseek-r1:free"],
  staticModels.openRouter["gemini-2.0-flash-exp:free"],
]);

const staticSupportImageInputModels = {
  ...staticModels.google,
  ...staticModels.xai,
  ...staticModels.openai,
  ...staticModels.anthropic,
  "grok-4.1-fast": staticModels.openRouter["grok-4.1-fast"],
};

const staticFilePartSupportByModel = new Map<
  LanguageModel,
  readonly string[]
>();

const registerFileSupport = (
  model: LanguageModel | undefined,
  mimeTypes: readonly string[] = DEFAULT_FILE_PART_MIME_TYPES,
) => {
  if (!model) return;
  staticFilePartSupportByModel.set(model, Array.from(mimeTypes));
};

registerFileSupport(staticModels.openai["gpt-4.1"], OPENAI_FILE_MIME_TYPES);
registerFileSupport(
  staticModels.openai["gpt-4.1-mini"],
  OPENAI_FILE_MIME_TYPES,
);

registerFileSupport(
  staticModels.google["gemini-2.5-flash-lite"],
  GEMINI_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.google["gemini-2.5-flash"],
  GEMINI_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.google["gemini-2.5-pro"],
  GEMINI_FILE_MIME_TYPES,
);

registerFileSupport(
  staticModels.anthropic["sonnet-4.5"],
  ANTHROPIC_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.anthropic["opus-4.5"],
  ANTHROPIC_FILE_MIME_TYPES,
);

registerFileSupport(staticModels.xai["grok-4-1-fast"], XAI_FILE_MIME_TYPES);
registerFileSupport(staticModels.xai["grok-4-1"], XAI_FILE_MIME_TYPES);
registerFileSupport(staticModels.xai["grok-3-mini"], XAI_FILE_MIME_TYPES);

registerFileSupport(
  staticModels.openRouter["gemini-2.0-flash-exp:free"],
  GEMINI_FILE_MIME_TYPES,
);
registerFileSupport(
  staticModels.openRouter["grok-4.1-fast"],
  XAI_FILE_MIME_TYPES,
);

const openaiCompatibleProviders = openaiCompatibleModelsSafeParse(
  process.env.OPENAI_COMPATIBLE_DATA,
);

const {
  providers: openaiCompatibleModels,
  unsupportedModels: openaiCompatibleUnsupportedModels,
} = createOpenAICompatibleModels(openaiCompatibleProviders);

const allModels = { ...openaiCompatibleModels, ...staticModels };

const allUnsupportedModels = new Set([
  ...openaiCompatibleUnsupportedModels,
  ...staticUnsupportedModels,
]);

export const isToolCallUnsupportedModel = (model: LanguageModel) => {
  return allUnsupportedModels.has(model);
};

const isImageInputUnsupportedModel = (model: LanguageModel) => {
  return !Object.values(staticSupportImageInputModels).includes(
    model as (typeof staticSupportImageInputModels)[keyof typeof staticSupportImageInputModels],
  );
};

export const getFilePartSupportedMimeTypes = (model: LanguageModel) => {
  return staticFilePartSupportByModel.get(model) ?? [];
};

const fallbackModel = staticModels.openai["gpt-4.1"];

export const customModelProvider = {
  modelsInfo: Object.entries(allModels).map(([provider, models]) => ({
    provider,
    models: Object.entries(models).map(([name, model]) => ({
      name,
      isToolCallUnsupported: isToolCallUnsupportedModel(model),
      isImageInputUnsupported: isImageInputUnsupportedModel(model),
      supportedFileMimeTypes: [...getFilePartSupportedMimeTypes(model)],
    })),
    hasAPIKey: checkProviderAPIKey(provider as keyof typeof staticModels),
  })),
  getModel: (model?: ChatModel): LanguageModel => {
    if (!model) return fallbackModel;
    return allModels[model.provider]?.[model.model] || fallbackModel;
  },
};

function checkProviderAPIKey(_provider: keyof typeof staticModels) {
  return true;
}
