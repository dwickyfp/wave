import {
  buildIssuerLookupTerms,
  type RetrievalIdentity,
} from "./financial-statement";

export type KnowledgeQueryConstraints = {
  issuer?: string | null;
  ticker?: string | null;
  page?: number | null;
  note?: string | null;
  noteNumber?: string | null;
  noteSubsection?: string | null;
  strictEntityMatch?: boolean;
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

  const tickerMatch = query.match(/\b(BBCA|BMRI|BBRI)\b/i);
  if (tickerMatch) {
    constraints.ticker = tickerMatch[1].toUpperCase();
  }

  const issuerPatterns = [
    { term: "bank central asia", canonical: "PT Bank Central Asia Tbk" },
    { term: " bca ", canonical: "PT Bank Central Asia Tbk" },
    { term: "bank mandiri", canonical: "PT Bank Mandiri (Persero) Tbk" },
    { term: " mandiri ", canonical: "PT Bank Mandiri (Persero) Tbk" },
    {
      term: "bank rakyat indonesia",
      canonical: "PT Bank Rakyat Indonesia (Persero) Tbk",
    },
    { term: " bri ", canonical: "PT Bank Rakyat Indonesia (Persero) Tbk" },
  ];
  const paddedQuery = ` ${query.toLowerCase()} `;
  const issuerPattern = issuerPatterns.find((entry) =>
    paddedQuery.includes(entry.term),
  );
  if (issuerPattern) {
    constraints.issuer = issuerPattern.canonical;
  }

  if (constraints.ticker || constraints.issuer) {
    constraints.strictEntityMatch = true;
  }

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
  if (merged.strictEntityMatch === undefined) {
    merged.strictEntityMatch = Boolean(merged.issuer || merged.ticker);
  }
  return merged;
}

export function matchesRetrievalIdentityConstraints(
  identity: RetrievalIdentity | null | undefined,
  constraints: KnowledgeQueryConstraints,
): boolean {
  if (!identity) {
    return !constraints.issuer && !constraints.ticker;
  }

  const lookup = buildIssuerLookupTerms(identity)
    .map((value) => value.toUpperCase())
    .join(" ");

  if (
    constraints.ticker &&
    !lookup.includes(constraints.ticker.toUpperCase())
  ) {
    return false;
  }

  if (
    constraints.issuer &&
    !lookup.includes(constraints.issuer.toUpperCase())
  ) {
    return false;
  }

  return true;
}
