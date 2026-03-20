import type {
  KnowledgeContextMode,
  KnowledgeImageMode,
  KnowledgeParseMode,
  KnowledgeParseRepairPolicy,
} from "app-types/knowledge";

export const ENFORCED_PARSE_MODE: KnowledgeParseMode = "always";
export const ENFORCED_PARSE_REPAIR_POLICY: KnowledgeParseRepairPolicy =
  "section-safe-reorder";
export const ENFORCED_CONTEXT_MODE: KnowledgeContextMode = "always-llm";
export const ENFORCED_IMAGE_MODE: KnowledgeImageMode = "always";

export const ENFORCED_KNOWLEDGE_INGEST_POLICY = {
  parseMode: ENFORCED_PARSE_MODE,
  parseRepairPolicy: ENFORCED_PARSE_REPAIR_POLICY,
  contextMode: ENFORCED_CONTEXT_MODE,
  imageMode: ENFORCED_IMAGE_MODE,
} as const;

type IngestPolicyShape = {
  parseMode?: KnowledgeParseMode | null;
  parseRepairPolicy?: KnowledgeParseRepairPolicy | null;
  contextMode?: KnowledgeContextMode | null;
  imageMode?: KnowledgeImageMode | null;
};

export function applyEnforcedKnowledgeIngestPolicy<T extends IngestPolicyShape>(
  value: T,
): T & typeof ENFORCED_KNOWLEDGE_INGEST_POLICY {
  return {
    ...value,
    ...ENFORCED_KNOWLEDGE_INGEST_POLICY,
  };
}
