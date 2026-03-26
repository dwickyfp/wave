import type { KnowledgeChunkMetadata } from "app-types/knowledge";

const ENTITY_STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "from",
  "guide",
  "page",
  "section",
  "that",
  "this",
  "with",
]);

export type ExtractedKnowledgeEntity = {
  canonicalName: string;
  normalizedName: string;
  entityType: "issuer" | "library" | "heading" | "code" | "term";
  aliases: string[];
  matchedText: string;
};

export function normalizeEntityName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addEntity(
  map: Map<string, ExtractedKnowledgeEntity>,
  candidate: ExtractedKnowledgeEntity | null,
) {
  if (!candidate?.normalizedName) return;
  const existing = map.get(candidate.normalizedName);
  if (!existing) {
    map.set(candidate.normalizedName, candidate);
    return;
  }

  existing.aliases = Array.from(
    new Set([...existing.aliases, ...candidate.aliases]),
  );
}

function buildEntity(
  matchedText: string,
  entityType: ExtractedKnowledgeEntity["entityType"],
  aliases: string[] = [],
): ExtractedKnowledgeEntity | null {
  const canonicalName = matchedText.trim();
  const normalizedName = normalizeEntityName(canonicalName);
  if (!normalizedName || ENTITY_STOP_WORDS.has(normalizedName)) {
    return null;
  }

  return {
    canonicalName,
    normalizedName,
    entityType,
    matchedText: canonicalName,
    aliases: Array.from(new Set([canonicalName, ...aliases].filter(Boolean))),
  };
}

function extractCodeIdentifiers(text: string): string[] {
  const matches = text.match(
    /\b[A-Z][A-Za-z0-9]+|[a-z][A-Za-z0-9_]{2,}\s*(?=\(|:|=)/g,
  );
  return Array.from(
    new Set(
      (matches ?? [])
        .map((value) => value.replace(/\s+/g, "").trim())
        .filter((value) => value.length >= 3),
    ),
  );
}

export function extractKnowledgeEntities(input: {
  headingPath?: string | null;
  content?: string | null;
  metadata?: KnowledgeChunkMetadata | null;
}): ExtractedKnowledgeEntity[] {
  const out = new Map<string, ExtractedKnowledgeEntity>();
  const metadata = input.metadata ?? null;

  const directTerms = [
    metadata?.canonicalTitle,
    metadata?.issuerName,
    metadata?.issuerTicker,
    metadata?.libraryId,
    metadata?.libraryVersion,
    metadata?.section,
    metadata?.sectionTitle,
    metadata?.noteTitle,
    ...(metadata?.headings ?? []),
    ...(metadata?.entityTerms ?? []),
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const term of directTerms) {
    addEntity(
      out,
      buildEntity(
        term,
        term === metadata?.issuerName || term === metadata?.issuerTicker
          ? "issuer"
          : term === metadata?.libraryId
            ? "library"
            : "heading",
      ),
    );
  }

  const headingPath = input.headingPath ?? metadata?.headingPath ?? "";
  for (const segment of headingPath.split(">").map((item) => item.trim())) {
    if (segment.length >= 3) {
      addEntity(out, buildEntity(segment, "heading"));
    }
  }

  const content = input.content ?? "";
  for (const identifier of extractCodeIdentifiers(content)) {
    addEntity(out, buildEntity(identifier, "code"));
  }

  const termMatches = content.match(/\b[A-Z]{2,6}\b/g) ?? [];
  for (const term of termMatches) {
    addEntity(out, buildEntity(term, "term"));
  }

  return Array.from(out.values());
}

export function buildEntityEmbeddingText(input: {
  metadata?: KnowledgeChunkMetadata | null;
  content?: string | null;
}): string {
  const entities = extractKnowledgeEntities({
    metadata: input.metadata,
    content: input.content,
  });
  return entities
    .flatMap((entity) => [entity.canonicalName, ...entity.aliases])
    .filter(Boolean)
    .join("\n");
}

export function extractEntityTermsFromQuery(query: string): string[] {
  const terms = new Set<string>();
  for (const match of query.matchAll(/\b[A-Z][A-Za-z0-9._-]{1,}\b/g)) {
    const term = match[0].trim();
    if (term.length >= 2) {
      terms.add(term);
    }
  }

  for (const match of query.matchAll(/\b[A-Z]{2,6}\b/g)) {
    terms.add(match[0]);
  }

  const normalized = query
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s.-]/gu, " ")
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !ENTITY_STOP_WORDS.has(term));

  for (const term of normalized) {
    terms.add(term);
  }

  return Array.from(terms);
}
