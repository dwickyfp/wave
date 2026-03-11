const KNOWN_FINANCIAL_ISSUERS = [
  {
    ticker: "BBCA",
    name: "PT Bank Central Asia Tbk",
    aliases: [
      "BBCA",
      "BCA",
      "Bank Central Asia",
      "PT BANK CENTRAL ASIA TBK",
      "BANKCENTRALASIA",
    ],
  },
  {
    ticker: "BMRI",
    name: "PT Bank Mandiri (Persero) Tbk",
    aliases: [
      "BMRI",
      "Mandiri",
      "Bank Mandiri",
      "PT BANK MANDIRI (PERSERO) TBK",
      "BANKMANDIRI",
    ],
  },
  {
    ticker: "BBRI",
    name: "PT Bank Rakyat Indonesia (Persero) Tbk",
    aliases: [
      "BBRI",
      "BRI",
      "Bank Rakyat Indonesia",
      "PT BANK RAKYAT INDONESIA (PERSERO) TBK",
      "BANKRAKYATINDONESIA",
    ],
  },
] as const;

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

  const filename = input.filename?.toLowerCase() ?? "";
  const filenameSignal =
    filename.includes("financial") ||
    filename.includes("statement") ||
    filename.includes("laporan") ||
    filename.includes("bbca") ||
    filename.includes("bmri") ||
    filename.includes("bbri");

  return {
    isFinancialStatement:
      matchedPhrases.length >= 2 ||
      noteHeadingCount >= 5 ||
      (pageCount >= 40 && (matchedPhrases.length >= 1 || filenameSignal)),
    noteHeadingCount,
    pageCount,
    matchedPhrases,
  };
}

function detectIssuerFromTexts(values: string[]): {
  issuerName: string;
  issuerTicker: string;
  issuerAliases: string[];
} | null {
  const normalizedValues = values.map(normalizeForMatch);
  const compactValues = values.map(compactForMatch);

  for (const issuer of KNOWN_FINANCIAL_ISSUERS) {
    const aliasMatches = issuer.aliases.filter((alias) => {
      const normalizedAlias = normalizeForMatch(alias);
      const compactAlias = compactForMatch(alias);
      return (
        normalizedValues.some(
          (value) =>
            value.includes(normalizedAlias) || normalizedAlias.includes(value),
        ) ||
        compactValues.some(
          (value) =>
            value.includes(compactAlias) || compactAlias.includes(value),
        )
      );
    });

    if (aliasMatches.length > 0) {
      return {
        issuerName: issuer.name,
        issuerTicker: issuer.ticker,
        issuerAliases: dedupeStrings([issuer.ticker, ...issuer.aliases]),
      };
    }
  }

  return null;
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
  const match = markdown.match(/\b(31\s+(?:DESEMBER|DECEMBER)\s+20\d{2})\b/i);
  return match?.[1]?.trim() ?? null;
}

function synthesizeCanonicalTitle(identity: {
  issuerName?: string | null;
  issuerTicker?: string | null;
  reportType?: string | null;
  fiscalYear?: number | null;
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
  const year = identity.fiscalYear ? String(identity.fiscalYear) : null;
  return dedupeStrings([base, reportType, year]).join(" ");
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
  });
  const autoTitleHasIssuer =
    !!input.autoTitle &&
    !!issuer &&
    detectIssuerFromTexts([input.autoTitle])?.issuerTicker ===
      issuer.issuerTicker;
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
