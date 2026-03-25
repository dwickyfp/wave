import { createHash } from "node:crypto";
import { generateText, Output } from "ai";
import { z } from "zod";
import { CacheKeys } from "lib/cache/cache-keys";
import { serverCache } from "lib/cache";
import { createModelFromConfig } from "lib/ai/provider-factory";
import { settingsRepository } from "lib/db/repository";
import { extractEntityTermsFromQuery } from "./entities";

const QUERY_REWRITE_MODEL_KEY = "knowledge-context-model";
const LEGACY_QUERY_REWRITE_MODEL_KEY = "contextx-model";
const QUERY_REWRITE_CACHE_TTL_MS = 5 * 60 * 1000;

const QUERY_REWRITE_SCHEMA = z.object({
  rewrites: z.array(z.string().min(1)).default([]),
  entityTerms: z.array(z.string().min(1)).default([]),
});

type QueryRewriteResult = z.infer<typeof QUERY_REWRITE_SCHEMA>;

async function getQueryRewriteModel() {
  const getSetting = settingsRepository.getSetting?.bind(settingsRepository);
  const getProviderByName =
    settingsRepository.getProviderByName?.bind(settingsRepository);
  const getModelForChat =
    settingsRepository.getModelForChat?.bind(settingsRepository);
  if (!getSetting || !getProviderByName || !getModelForChat) {
    return null;
  }

  const config =
    ((await getSetting(QUERY_REWRITE_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null) ??
    ((await getSetting(LEGACY_QUERY_REWRITE_MODEL_KEY)) as {
      provider: string;
      model: string;
    } | null);
  if (!config?.provider || !config.model) return null;

  const providerConfig = await getProviderByName(config.provider);
  if (!providerConfig?.enabled) return null;
  const modelConfig = await getModelForChat(config.provider, config.model);

  return createModelFromConfig(
    config.provider,
    modelConfig?.apiName ?? config.model,
    providerConfig.apiKey,
    providerConfig.baseUrl,
    providerConfig.settings,
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

export async function rewriteKnowledgeQuery(
  query: string,
): Promise<QueryRewriteResult> {
  const directEntityTerms = extractEntityTermsFromQuery(query);
  const cacheHash = createHash("sha256")
    .update(query.normalize("NFKC"))
    .digest("hex");
  const cacheKey = CacheKeys.knowledgeQueryRewrite(cacheHash);
  const cached = await serverCache.get<QueryRewriteResult>(cacheKey);
  if (cached) {
    return {
      rewrites: uniqueStrings(cached.rewrites),
      entityTerms: uniqueStrings([...directEntityTerms, ...cached.entityTerms]),
    };
  }

  const model = await getQueryRewriteModel();
  if (!model) {
    return {
      rewrites: [],
      entityTerms: directEntityTerms,
    };
  }

  try {
    const { output } = await generateText({
      model,
      temperature: 0,
      output: Output.object({
        schema: QUERY_REWRITE_SCHEMA,
        name: "knowledge_query_rewrite",
        description: "Query rewrites and entity terms for retrieval expansion.",
      }),
      prompt: [
        "Rewrite the retrieval query into up to 3 concise alternatives.",
        "Expand acronyms when the expansion is obvious.",
        "Preserve source IDs, note numbers, page references, version markers, and code identifiers.",
        "Return reusable entity terms separately.",
        `Query: ${query}`,
      ].join("\n"),
    });

    const value = {
      rewrites: uniqueStrings(output.rewrites).filter(
        (item) => item.toLowerCase() !== query.trim().toLowerCase(),
      ),
      entityTerms: uniqueStrings([...directEntityTerms, ...output.entityTerms]),
    } satisfies QueryRewriteResult;
    await serverCache.set(cacheKey, value, QUERY_REWRITE_CACHE_TTL_MS);
    return value;
  } catch {
    return {
      rewrites: [],
      entityTerms: directEntityTerms,
    };
  }
}
