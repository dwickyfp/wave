const FINANCIAL_STATEMENT_PHRASES = [
  "laporan keuangan konsolidasian",
  "catatan atas laporan keuangan",
  "laporan posisi keuangan",
  "laporan laba rugi",
  "laporan arus kas",
  "financial statements",
  "notes to the financial statements",
  "consolidated statement of financial position",
  "marketable securities",
  "efek-efek",
];
const FINANCE_QUERY_TERMS = [
  "annual report",
  "balance sheet",
  "catatan",
  "dividen",
  "earnings",
  "emiten",
  "financial",
  "issuer",
  "laporan",
  "laba rugi",
  "marketable securities",
  "neraca",
  "note",
  "quarter",
  "saham",
  "statement",
  "ticker",
];
const GENERIC_TICKER_STOP_WORDS = new Set([
  "APBN",
  "APIX",
  "BANK",
  "BODY",
  "CODE",
  "DATA",
  "DEMO",
  "FILE",
  "HTML",
  "HTTP",
  "HTTPS",
  "INFO",
  "JSON",
  "NOTE",
  "NULL",
  "PAGE",
  "PDFX",
  "TEST",
  "TEXT",
  "TRUE",
  "TYPE",
  "UUID",
  "XMLS",
]);
const ISSUER_NOISE_TERMS = new Set([
  "annual",
  "catatan",
  "consolidated",
  "financial",
  "keuangan",
  "laporan",
  "notes",
  "report",
  "statement",
  "statements",
  "tahun",
]);
const CORPORATE_NOISE_TERMS = new Set([
  "company",
  "corp",
  "corporation",
  "group",
  "holding",
  "holdings",
  "inc",
  "limited",
  "ltd",
  "persero",
  "pt",
  "tbk",
]);

export type FinancialStatementClassification = {
  isFinancialStatement: boolean;
  noteHeadingCount: number;
  pageCount: number;
  matchedPhrases: string[];
};

export type RetrievalIdentity = {
  canonicalTitle: string;
  autoTitle?: string | null;
  issuerName?: string | null;
  issuerTicker?: string | null;
  issuerAliases?: string[];
  reportType?: string | null;
  fiscalYear?: number | null;
  periodEnd?: string | null;
  pageCount?: number | null;
  isFinancialStatement?: boolean;
};

export type FinancialNoteMatch = {
  noteNumber: string;
  noteTitle: string;
  continued: boolean;
};

export type FinancialSubsectionMatch = {
  noteSubsection: string;
  title: string;
};

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function compactForMatch(value: string): string {
  return normalizeForMatch(value).replace(/\s+/g, "");
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeFilenameText(value: string): string {
  return value
    .replace(/\.[A-Za-z0-9]+$/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanIssuerText(value: string): string {
  return value
    .replace(/<!--CTX_PAGE:\d+-->/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function trimIssuerQueryCandidate(value: string): string {
  return cleanIssuerText(value)
    .replace(
      /\b(?:annual report|annual|report|financial|statements?|laporan|page|halaman|note|catatan|marketable|securities|tahun|year)\b.*$/i,
      "",
    )
    .replace(/\b\d{1,4}\b.*$/g, "")
    .trim();
}

function stripIssuerBoilerplate(value: string): string {
  return cleanIssuerText(value)
    .replace(/\bPT\.?\s+/i, "")
    .replace(/\((?:Persero|Tbk)\)/gi, " ")
    .replace(/\bTbk\.?\b/gi, " ")
    .replace(
      /\b(?:Corp(?:oration)?|Inc\.?|Ltd\.?|Limited|Holdings?|Group)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeIssuerWords(value: string): string[] {
  return stripIssuerBoilerplate(value)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
}

function buildIssuerAcronym(value: string): string | null {
  const words = tokenizeIssuerWords(value).filter(
    (word) => !CORPORATE_NOISE_TERMS.has(word.toLowerCase()),
  );
  if (words.length < 2 || words.length > 5) {
    return null;
  }

  const acronym = words
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return acronym.length >= 2 && acronym.length <= 5 ? acronym : null;
}

function buildIssuerAliases(input: {
  issuerName: string;
  issuerTicker?: string | null;
}): string[] {
  const stripped = stripIssuerBoilerplate(input.issuerName);
  const words = tokenizeIssuerWords(input.issuerName);
  const withoutBank =
    words[0]?.toLowerCase() === "bank" && words.length >= 2
      ? words.slice(1).join(" ")
      : null;
  const primaryWord =
    words[0]?.toLowerCase() === "bank"
      ? (words[1] ?? null)
      : (words[0] ?? null);
  const acronym = buildIssuerAcronym(input.issuerName);

  return dedupeStrings([
    input.issuerTicker ?? null,
    input.issuerName,
    stripped,
    withoutBank,
    primaryWord && primaryWord.length >= 5 ? primaryWord : null,
    acronym,
    normalizeForMatch(input.issuerName),
    compactForMatch(input.issuerName),
  ]);
}

function hasFinanceContextSignal(value: string): boolean {
  const normalized = ` ${value.toLowerCase()} `;
  return FINANCE_QUERY_TERMS.some((term) => normalized.includes(` ${term} `));
}

function normalizeTickerCandidate(value: string): string | null {
  const candidate = value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(candidate)) {
    return null;
  }
  if (GENERIC_TICKER_STOP_WORDS.has(candidate)) {
    return null;
  }
  return candidate;
}

function collectIssuerNameCandidates(values: string[]): string[] {
  const candidates = new Set<string>();

  const pushCandidate = (value: string | null | undefined) => {
    if (!value) return;
    const cleaned = cleanIssuerText(value);
    if (!cleaned) return;
    const lowered = cleaned.toLowerCase();
    if (ISSUER_NOISE_TERMS.has(lowered)) return;
    if (
      FINANCIAL_STATEMENT_PHRASES.some((phrase) => lowered.includes(phrase)) ||
      /\b(?:annual report|laporan|catatan|notes?|financial statements?)\b/i.test(
        cleaned,
      )
    ) {
      return;
    }
    const alphaCount = (cleaned.match(/[A-Za-z]/g) ?? []).length;
    if (alphaCount < 4) return;
    candidates.add(cleaned);
  };

  const issuerPatterns = [
    /\bPT\.?\s+[A-Za-z0-9&.,()'/-]+(?:\s+[A-Za-z0-9&.,()'/-]+){0,8}\s+Tbk\b/gi,
    /\b[A-Z][A-Za-z0-9&.,()'/-]+(?:\s+[A-Z][A-Za-z0-9&.,()'/-]+){1,6}\s+Tbk\b/gi,
    /\b[A-Z][A-Za-z0-9&.,()'/-]+(?:\s+[A-Z][A-Za-z0-9&.,()'/-]+){1,6}\s+(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|Limited|Holdings?|Group)\b/gi,
  ];

  for (const value of values) {
    const normalizedValue = normalizeFilenameText(value);
    for (const pattern of issuerPatterns) {
      for (const match of normalizedValue.matchAll(pattern)) {
        pushCandidate(match[0]);
      }
    }

    const firstMeaningfulLines = normalizedValue
      .split("\n")
      .map((line) => cleanIssuerText(line))
      .filter(Boolean)
      .slice(0, 8);
    for (const line of firstMeaningfulLines) {
      if (
        /^PT\.?\s+/i.test(line) ||
        /\bTbk\b/i.test(line) ||
        /\b(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|Limited|Holdings?|Group)\b/i.test(
          line,
        ) ||
        /^Bank\s+/i.test(line)
      ) {
        pushCandidate(line);
      }
    }
  }

  return Array.from(candidates);
}

function extractIssuerNameFromTexts(values: string[]): string | null {
  const candidates = collectIssuerNameCandidates(values);
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((candidate) => {
      let score = 0;
      if (/^PT\.?\s+/i.test(candidate)) score += 3;
      if (/\bTbk\b/i.test(candidate)) score += 3;
      if (/^Bank\s+/i.test(stripIssuerBoilerplate(candidate))) score += 2;
      if (
        /\b(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|Limited)\b/i.test(candidate)
      ) {
        score += 2;
      }
      const tokenCount = tokenizeIssuerWords(candidate).length;
      if (tokenCount >= 2 && tokenCount <= 8) score += 1;
      return { candidate, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.candidate.length - right.candidate.length;
    });

  return scored[0]?.candidate ?? null;
}

function extractTickerFromTexts(
  values: string[],
  issuerName?: string | null,
): string | null {
  const tickerScores = new Map<string, number>();
  const issuerWords = new Set(
    issuerName
      ? tokenizeIssuerWords(issuerName).map((word) => word.toUpperCase())
      : [],
  );

  const boost = (candidate: string | null, score: number) => {
    if (!candidate) return;
    if (issuerWords.has(candidate)) return;
    tickerScores.set(candidate, (tickerScores.get(candidate) ?? 0) + score);
  };

  for (const value of values) {
    const normalized = normalizeFilenameText(value);
    const upper = normalized.toUpperCase();
    const hasIssuerSignal =
      !!issuerName &&
      normalizeForMatch(normalized).includes(normalizeForMatch(issuerName));
    const hasFinanceSignal = hasFinanceContextSignal(normalized);
    const filenameLike = /[_./-]/.test(value) && !value.includes("\n");

    for (const match of normalized.matchAll(
      /\b(?:ticker|kode saham|stock code|trading code|emiten)\s*[:=-]?\s*\(?([A-Za-z]{4})\)?\b/gi,
    )) {
      boost(normalizeTickerCandidate(match[1]), 5);
    }

    for (const match of normalized.matchAll(/\(([A-Z]{4})\)/g)) {
      boost(normalizeTickerCandidate(match[1]), hasIssuerSignal ? 4 : 2);
    }

    if (hasIssuerSignal || hasFinanceSignal) {
      const genericTickerPattern = filenameLike
        ? /\b([A-Za-z]{4})\b/g
        : /\b([A-Z]{4})\b/g;
      const sourceText = filenameLike ? upper : normalized;
      for (const match of sourceText.matchAll(genericTickerPattern)) {
        boost(normalizeTickerCandidate(match[1]), hasIssuerSignal ? 3 : 1);
      }
    }
  }

  const ranked = Array.from(tickerScores.entries()).sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });

  return ranked[0]?.[0] ?? null;
}

export function extractTickerConstraintFromQuery(query: string): string | null {
  const upper = query.toUpperCase();
  const explicitMatch = upper.match(
    /\b(?:TICKER|KODE SAHAM|STOCK CODE|EMITEN)\s*[:=-]?\s*\(?([A-Z]{4})\)?\b/,
  );
  if (explicitMatch) {
    return normalizeTickerCandidate(explicitMatch[1]);
  }

  const tokens = Array.from(
    new Set(
      Array.from(upper.matchAll(/\b([A-Z]{4})\b/g)).map((match) => match[1]),
    ),
  )
    .map((token) => normalizeTickerCandidate(token))
    .filter((token): token is string => Boolean(token));
  if (tokens.length === 0) {
    return null;
  }

  const trimmed = query.trim().toUpperCase();
  if (tokens.length === 1 && trimmed === tokens[0]) {
    return tokens[0];
  }

  if (
    hasFinanceContextSignal(query) ||
    /\b(?:page|halaman|note|catatan|issuer)\b/i.test(query)
  ) {
    return tokens[0];
  }

  return null;
}

export function extractIssuerConstraintFromQuery(query: string): string | null {
  const explicitPatterns = [
    /\bPT\.?\s+[A-Za-z0-9&.,()'/-]+(?:\s+[A-Za-z0-9&.,()'/-]+){0,8}\s+Tbk\b/i,
    /\b[A-Z][A-Za-z0-9&.,()'/-]+(?:\s+[A-Z][A-Za-z0-9&.,()'/-]+){1,6}\s+Tbk\b/i,
    /\b[A-Z][A-Za-z0-9&.,()'/-]+(?:\s+[A-Z][A-Za-z0-9&.,()'/-]+){1,6}\s+(?:Corporation|Corp\.?|Inc\.?|Ltd\.?|Limited|Holdings?|Group)\b/i,
  ];
  for (const pattern of explicitPatterns) {
    const match = cleanIssuerText(query).match(pattern);
    if (match?.[0]) {
      return trimIssuerQueryCandidate(match[0]);
    }
  }

  if (!hasFinanceContextSignal(query)) {
    return null;
  }

  const bankMatch = cleanIssuerText(query).match(
    /\bBank\s+[A-Za-z0-9&.,()'/-]+(?:\s+[A-Za-z0-9&.,()'/-]+){0,4}\b/i,
  );
  if (bankMatch?.[0]) {
    return trimIssuerQueryCandidate(bankMatch[0]);
  }

  return null;
}

export function matchFinancialNoteHeading(
  line: string,
): FinancialNoteMatch | null {
  const stripped = line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*|\*\*$/g, "")
    .trim();
  const match = stripped.match(
    /^(?:catatan|note)?\s*(\d{1,3})\s*[.:]\s*(.+?)(?:\s*\((lanjutan|continued)\))?$/i,
  );
  if (!match) return null;

  const noteTitle = match[2].trim();
  if (noteTitle.length < 4) return null;

  const alphaCount = (noteTitle.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (noteTitle.match(/\d/g) ?? []).length;
  if (alphaCount < 3 || digitCount > alphaCount) return null;

  return {
    noteNumber: match[1],
    noteTitle,
    continued: Boolean(match[3]),
  };
}

export function matchFinancialSubsection(
  line: string,
): FinancialSubsectionMatch | null {
  const stripped = line.replace(/^#{1,6}\s*/, "").trim();
  const match = stripped.match(/^([a-z])\.\s+(.+)$/i);
  if (!match) return null;

  const title = match[2].trim();
  if (title.length < 3) return null;
  return {
    noteSubsection: match[1].toLowerCase(),
    title,
  };
}

export function classifyFinancialStatementDocument(input: {
  markdown: string;
  pageCount?: number;
  filename?: string | null;
}): FinancialStatementClassification {
  const normalized = input.markdown.toLowerCase();
  const matchedPhrases = FINANCIAL_STATEMENT_PHRASES.filter((phrase) =>
    normalized.includes(phrase),
  );
  const noteHeadingCount = input.markdown
    .split("\n")
    .map((line) => matchFinancialNoteHeading(line))
    .filter(Boolean).length;
  const pageCount =
    input.pageCount ??
    Math.max(1, (input.markdown.match(/<!--CTX_PAGE:\d+-->/g) ?? []).length);

  const filename = normalizeFilenameText(input.filename ?? "");
  const filenameSignal =
    /\b(?:financial|statement|laporan|annual|report)\b/i.test(filename) ||
    /\b[A-Z]{4}\b/.test(filename.toUpperCase());

  return {
    isFinancialStatement:
      matchedPhrases.length >= 2 ||
      noteHeadingCount >= 5 ||
      (pageCount >= 40 &&
        ((matchedPhrases.length >= 1 && filenameSignal) ||
          noteHeadingCount >= 2)),
    noteHeadingCount,
    pageCount,
    matchedPhrases,
  };
}

function detectIssuerFromTexts(values: string[]): {
  issuerName: string;
  issuerTicker: string | null;
  issuerAliases: string[];
} | null {
  const issuerName = extractIssuerNameFromTexts(values);
  if (!issuerName) {
    return null;
  }

  const issuerTicker = extractTickerFromTexts(values, issuerName);
  return {
    issuerName,
    issuerTicker,
    issuerAliases: buildIssuerAliases({
      issuerName,
      issuerTicker,
    }),
  };
}

function extractReportType(markdown: string): string | null {
  const normalized = markdown.toLowerCase();
  if (
    normalized.includes("laporan keuangan konsolidasian") ||
    normalized.includes("financial statements")
  ) {
    return "financial_statements";
  }
  if (normalized.includes("annual report")) {
    return "annual_report";
  }
  return null;
}

function extractFiscalYear(values: string[]): number | null {
  const joined = values.join(" ");
  const years = Array.from(joined.matchAll(/\b(20\d{2})\b/g))
    .map((match) => Number(match[1]))
    .filter((year) => year >= 2000 && year <= 2100);
  if (years.length === 0) return null;
  return Math.max(...years);
}

function extractPeriodEnd(markdown: string): string | null {
  // Capture all common fiscal quarter-end date patterns so documents from
  // different quarters get unique periodEnd values.
  // Q4: 31 December / 31 Desember
  // Q3: 30 September
  // Q2: 30 June / 30 Juni
  // Q1: 31 March / 31 Maret
  const patterns = [
    /\b(31\s+(?:DESEMBER|DECEMBER)\s+20\d{2})\b/i,
    /\b(30\s+SEPTEMBER\s+20\d{2})\b/i,
    /\b(30\s+(?:JUNI|JUNE)\s+20\d{2})\b/i,
    /\b(31\s+(?:MARET|MARCH)\s+20\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = markdown.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function synthesizeCanonicalTitle(identity: {
  issuerName?: string | null;
  issuerTicker?: string | null;
  reportType?: string | null;
  fiscalYear?: number | null;
  periodEnd?: string | null;
}): string | null {
  if (!identity.issuerName && !identity.issuerTicker) return null;

  const base = dedupeStrings([identity.issuerName, identity.issuerTicker]).join(
    " / ",
  );
  const reportType =
    identity.reportType === "financial_statements"
      ? "Financial Statements"
      : identity.reportType === "annual_report"
        ? "Annual Report"
        : null;

  // Prefer the precise period-end date string (gives uniqueness across quarters).
  // Fall back to fiscal year when only that is available.
  const period = identity.periodEnd
    ? identity.periodEnd
    : identity.fiscalYear
      ? String(identity.fiscalYear)
      : null;

  return dedupeStrings([base, reportType, period]).join(" ");
}

export function buildFinancialStatementRetrievalIdentity(input: {
  markdown: string;
  fallbackTitle: string;
  originalFilename?: string | null;
  autoTitle?: string | null;
  pageCount?: number | null;
}): RetrievalIdentity {
  const classification = classifyFinancialStatementDocument({
    markdown: input.markdown,
    pageCount: input.pageCount ?? undefined,
    filename: input.originalFilename ?? null,
  });

  if (!classification.isFinancialStatement) {
    return {
      canonicalTitle:
        input.autoTitle?.trim() ||
        input.fallbackTitle ||
        input.originalFilename ||
        "Untitled",
      autoTitle: input.autoTitle ?? null,
      issuerName: null,
      issuerTicker: null,
      issuerAliases: [],
      reportType: null,
      fiscalYear: null,
      periodEnd: null,
      pageCount: input.pageCount ?? classification.pageCount,
      isFinancialStatement: false,
    };
  }

  const issuer = detectIssuerFromTexts([
    input.markdown.slice(0, 12_000),
    input.fallbackTitle,
    input.originalFilename ?? "",
    input.autoTitle ?? "",
  ]);
  const reportType = extractReportType(input.markdown);
  const fiscalYear = extractFiscalYear([
    input.markdown.slice(0, 12_000),
    input.fallbackTitle,
    input.originalFilename ?? "",
  ]);
  const periodEnd = extractPeriodEnd(input.markdown);
  const synthesizedTitle = synthesizeCanonicalTitle({
    issuerName: issuer?.issuerName,
    issuerTicker: issuer?.issuerTicker,
    reportType,
    fiscalYear,
    periodEnd,
  });
  const autoTitleIssuer = input.autoTitle
    ? detectIssuerFromTexts([input.autoTitle])
    : null;
  const autoTitleHasIssuer =
    !!input.autoTitle &&
    !!issuer &&
    ((!!autoTitleIssuer?.issuerTicker &&
      !!issuer.issuerTicker &&
      autoTitleIssuer.issuerTicker === issuer.issuerTicker) ||
      (!!autoTitleIssuer?.issuerName &&
        normalizeForMatch(autoTitleIssuer.issuerName) ===
          normalizeForMatch(issuer.issuerName)));
  const canonicalTitle =
    (autoTitleHasIssuer ? input.autoTitle?.trim() : null) ||
    synthesizedTitle ||
    input.fallbackTitle ||
    input.originalFilename ||
    "Untitled";

  return {
    canonicalTitle,
    autoTitle: input.autoTitle ?? null,
    issuerName: issuer?.issuerName ?? null,
    issuerTicker: issuer?.issuerTicker ?? null,
    issuerAliases: issuer?.issuerAliases ?? [],
    reportType,
    fiscalYear,
    periodEnd,
    pageCount: input.pageCount ?? classification.pageCount,
    isFinancialStatement: classification.isFinancialStatement,
  };
}

export function buildIssuerLookupTerms(identity?: RetrievalIdentity | null) {
  if (!identity) return [];
  return dedupeStrings([
    identity.canonicalTitle,
    identity.issuerName,
    identity.issuerTicker,
    ...(identity.issuerAliases ?? []),
  ]);
}
