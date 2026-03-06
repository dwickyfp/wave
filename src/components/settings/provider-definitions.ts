import {
  getProviderCustomFields,
  type ProviderCustomFieldDefinition,
} from "lib/settings/provider-custom-fields";

export type ProviderCustomField = ProviderCustomFieldDefinition;

export type ProviderDefinition = {
  name: string;
  displayName: string;
  description: string;
  color: string; // Tailwind bg color class
  textColor: string; // Tailwind text color class
  initials: string; // Short label for icon
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  apiKeyPlaceholder?: string;
  docsUrl?: string;
  customFields?: ProviderCustomFieldDefinition[];
};

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  {
    name: "openrouter",
    displayName: "OpenRouter",
    description: "Unified gateway to 300+ models from all providers",
    color: "bg-violet-500/10",
    textColor: "text-violet-600 dark:text-violet-400",
    initials: "OR",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "sk-or-v1-...",
  },
  {
    name: "openai",
    displayName: "OpenAI",
    description: "GPT-4, o3, o4-mini and more",
    color: "bg-emerald-500/10",
    textColor: "text-emerald-600 dark:text-emerald-400",
    initials: "OA",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "sk-...",
  },
  {
    name: "azure",
    displayName: "Azure OpenAI",
    description: "Azure-hosted OpenAI deployments",
    color: "bg-cyan-500/10",
    textColor: "text-cyan-600 dark:text-cyan-400",
    initials: "AZ",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "Azure OpenAI API key",
    docsUrl: "https://ai-sdk.dev/providers/ai-sdk-providers/azure",
    customFields: getProviderCustomFields("azure"),
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    description: "Claude Sonnet, Haiku, Opus",
    color: "bg-orange-500/10",
    textColor: "text-orange-600 dark:text-orange-400",
    initials: "AN",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "sk-ant-...",
  },
  {
    name: "google",
    displayName: "Google AI",
    description: "Gemini 2.5 Flash, Pro and more",
    color: "bg-blue-500/10",
    textColor: "text-blue-600 dark:text-blue-400",
    initials: "GG",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "AIza...",
  },
  {
    name: "xai",
    displayName: "xAI Grok",
    description: "Grok models by xAI",
    color: "bg-zinc-500/10",
    textColor: "text-zinc-600 dark:text-zinc-400",
    initials: "XA",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "xai-...",
  },
  {
    name: "groq",
    displayName: "Groq",
    description: "Ultra-fast inference on Groq LPU",
    color: "bg-red-500/10",
    textColor: "text-red-600 dark:text-red-400",
    initials: "GQ",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "gsk_...",
  },
  {
    name: "ollama",
    displayName: "Ollama",
    description: "Run models locally with Ollama",
    color: "bg-teal-500/10",
    textColor: "text-teal-600 dark:text-teal-400",
    initials: "OL",
    needsApiKey: false,
    needsBaseUrl: true,
    baseUrlPlaceholder: "http://localhost:11434/api",
  },
  {
    name: "snowflake",
    displayName: "Snowflake Cortex",
    description: "Run LLMs via Snowflake Cortex AI (OpenAI-compatible)",
    color: "bg-sky-500/10",
    textColor: "text-sky-600 dark:text-sky-400",
    initials: "SF",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlLabel: "Account Identifier",
    baseUrlPlaceholder: "myorg-myaccount",
    apiKeyPlaceholder: "Programmatic Access Token (PAT)",
    docsUrl:
      "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-llm-rest-api",
  },
  {
    name: "cohere",
    displayName: "Cohere",
    description: "Command R+ LLMs and reranking models",
    color: "bg-purple-500/10",
    textColor: "text-purple-600 dark:text-purple-400",
    initials: "CO",
    needsApiKey: true,
    needsBaseUrl: false,
    apiKeyPlaceholder: "co-...",
    docsUrl: "https://docs.cohere.com/docs/the-cohere-platform",
  },
  {
    name: "openai-compatible",
    displayName: "OpenAI Compatible",
    description: "Any OpenAI-compatible API endpoint",
    color: "bg-slate-500/10",
    textColor: "text-slate-600 dark:text-slate-400",
    initials: "OC",
    needsApiKey: true,
    needsBaseUrl: true,
    baseUrlPlaceholder: "https://api.example.com/v1",
    apiKeyPlaceholder: "sk-...",
  },
];

export function getProviderDef(name: string): ProviderDefinition {
  return (
    PROVIDER_DEFINITIONS.find((p) => p.name === name) ?? {
      name,
      displayName: name.charAt(0).toUpperCase() + name.slice(1),
      description: "Custom provider",
      color: "bg-muted",
      textColor: "text-muted-foreground",
      initials: name.slice(0, 2).toUpperCase(),
      needsApiKey: true,
      needsBaseUrl: false,
    }
  );
}
