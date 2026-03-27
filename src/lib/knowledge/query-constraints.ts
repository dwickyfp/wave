import { extractEntityTermsFromQuery } from "./entities";

export type KnowledgeQueryConstraints = {
  page?: number | null;
  note?: string | null;
  noteNumber?: string | null;
  noteSubsection?: string | null;
  entityTerms?: string[];
};

export function extractKnowledgeQueryConstraints(
  query: string,
): KnowledgeQueryConstraints {
  const constraints: KnowledgeQueryConstraints = {};

  const pageMatch = query.match(/\b(?:page|halaman|pg)\s+(\d{1,4})\b/i);
  if (pageMatch) {
    constraints.page = Number(pageMatch[1]);
  }

  const noteMatch =
    query.match(/\b(?:catatan|note)\s+(\d{1,3})(?:\s*[\.-]?\s*([a-z]))?\b/i) ??
    query.match(/\b(\d{1,3})\.([a-z])\b/i);
  if (noteMatch) {
    constraints.noteNumber = noteMatch[1];
    constraints.noteSubsection = noteMatch[2]?.toLowerCase() ?? null;
    constraints.note = constraints.noteSubsection
      ? `${constraints.noteNumber}.${constraints.noteSubsection}`
      : constraints.noteNumber;
  }

  constraints.entityTerms = extractEntityTermsFromQuery(query);

  return constraints;
}

export function mergeKnowledgeQueryConstraints(
  query: string,
  overrides?: KnowledgeQueryConstraints,
): KnowledgeQueryConstraints {
  const extracted = extractKnowledgeQueryConstraints(query);
  const merged: KnowledgeQueryConstraints = {
    ...extracted,
    ...(overrides ?? {}),
  };
  if (
    merged.note &&
    (!merged.noteNumber || merged.noteSubsection === undefined)
  ) {
    const noteMatch = merged.note.match(/^(\d{1,3})(?:[.\-]?([a-z]))?$/i);
    if (noteMatch) {
      merged.noteNumber = noteMatch[1];
      merged.noteSubsection = noteMatch[2]?.toLowerCase() ?? null;
    }
  }
  merged.entityTerms = Array.from(
    new Set([
      ...(extracted.entityTerms ?? []),
      ...(overrides?.entityTerms ?? []),
    ]),
  );
  return merged;
}
