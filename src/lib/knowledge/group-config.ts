import type { CreateKnowledgeGroupInput } from "app-types/knowledge";
import { applyEnforcedKnowledgeIngestPolicy } from "./quality-ingest-policy";

type KnowledgeGroupPersistenceInput = Pick<
  CreateKnowledgeGroupInput,
  | "embeddingModel"
  | "embeddingProvider"
  | "rerankingModel"
  | "rerankingProvider"
  | "parsingModel"
  | "parsingProvider"
  | "retrievalThreshold"
  | "chunkSize"
  | "chunkOverlapPercent"
>;

type ParseModelConfig = {
  provider: string;
  model: string;
} | null;

export function buildKnowledgeGroupPersistenceFields(
  data: KnowledgeGroupPersistenceInput,
) {
  const enforcedPolicy = applyEnforcedKnowledgeIngestPolicy({});

  return {
    embeddingModel: data.embeddingModel ?? "text-embedding-3-small",
    embeddingProvider: data.embeddingProvider ?? "openai",
    rerankingModel: data.rerankingModel ?? null,
    rerankingProvider: data.rerankingProvider ?? null,
    parsingModel: data.parsingModel ?? null,
    parsingProvider: data.parsingProvider ?? null,
    retrievalThreshold: data.retrievalThreshold ?? 0,
    parseMode: enforcedPolicy.parseMode,
    parseRepairPolicy: enforcedPolicy.parseRepairPolicy,
    contextMode: enforcedPolicy.contextMode,
    imageMode: enforcedPolicy.imageMode,
    lazyRefinementEnabled: true,
    mcpEnabled: false,
    chunkSize: data.chunkSize ?? 768,
    chunkOverlapPercent: data.chunkOverlapPercent ?? 10,
  };
}

export function resolveKnowledgeParseModel(input: {
  groupParsingModel?: string | null;
  groupParsingProvider?: string | null;
  defaultParseModel?: ParseModelConfig | undefined;
}): ParseModelConfig {
  const groupParsingProvider = input.groupParsingProvider?.trim();
  const groupParsingModel = input.groupParsingModel?.trim();

  if (groupParsingProvider && groupParsingModel) {
    return {
      provider: groupParsingProvider,
      model: groupParsingModel,
    };
  }

  return input.defaultParseModel ?? null;
}
