import {
  countLegalReferenceOverlap,
  extractLegalReferenceKeys,
  normalizeLegalReferenceText,
} from "./legal-references";
import { parsePageMarker } from "./page-markers";

export type MarkdownPageSlice = {
  pageNumber: number;
  normalized: string;
  tokenSet: Set<string>;
  legalReferenceSet: Set<string>;
};

export type CitationPageInference = {
  pageNumber: number;
  score: number;
  usedLegalReference: boolean;
};

export function normalizeCitationLookupText(value: string): string {
  return normalizeLegalReferenceText(
    value
      .replace(/<!--CTX_PAGE:\d+-->/g, " ")
      .replace(/`{1,3}[^`]*`{1,3}/g, " "),
  );
}

export function tokenizeCitationLookupText(value: string): string[] {
  return Array.from(
    new Set(
      normalizeCitationLookupText(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4),
    ),
  );
}

export function splitMarkdownIntoPageSlices(
  markdown?: string,
): MarkdownPageSlice[] {
  if (!markdown?.trim()) return [];

  const pages: MarkdownPageSlice[] = [];
  let currentPage = 1;
  let currentLines: string[] = [];

  const flush = () => {
    const pageText = currentLines.join("\n");
    const normalized = normalizeCitationLookupText(pageText);
    if (!normalized) return;

    pages.push({
      pageNumber: currentPage,
      normalized,
      tokenSet: new Set(tokenizeCitationLookupText(normalized)),
      legalReferenceSet: extractLegalReferenceKeys(pageText),
    });
  };

  for (const line of markdown.split("\n")) {
    const pageMarker = parsePageMarker(line.trim());
    if (pageMarker != null) {
      flush();
      currentPage = pageMarker;
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  flush();
  return pages;
}

function scorePageSliceForSnippet(input: {
  page: MarkdownPageSlice;
  normalizedSnippet: string;
  snippetTokens: string[];
  snippetLegalReferences: Set<string>;
}): CitationPageInference | null {
  if (!input.normalizedSnippet && input.snippetLegalReferences.size === 0) {
    return null;
  }

  const anchorCandidates = [
    input.normalizedSnippet,
    input.normalizedSnippet.slice(0, 180),
    input.normalizedSnippet.slice(0, 120),
    input.normalizedSnippet.slice(0, 72),
    input.normalizedSnippet.slice(0, 40),
  ].filter((anchor, index, anchors) => {
    return anchor.length >= 24 && anchors.indexOf(anchor) === index;
  });

  let baseScore = 0;
  for (let index = 0; index < anchorCandidates.length; index += 1) {
    const anchor = anchorCandidates[index];
    if (input.page.normalized.includes(anchor)) {
      baseScore = 1000 - index * 100 + anchor.length / 1000;
      break;
    }
  }

  if (baseScore === 0 && input.snippetTokens.length > 0) {
    const overlapCount = input.snippetTokens.filter((token) =>
      input.page.tokenSet.has(token),
    ).length;
    const overlapRatio = overlapCount / input.snippetTokens.length;
    if (overlapRatio >= 0.45) {
      baseScore = overlapRatio;
    }
  }

  const legalReferenceMatches = countLegalReferenceOverlap(
    input.snippetLegalReferences,
    input.page.legalReferenceSet,
  );

  if (input.snippetLegalReferences.size > 0) {
    if (legalReferenceMatches > 0) {
      return {
        pageNumber: input.page.pageNumber,
        score: 2000 + legalReferenceMatches * 250 + baseScore,
        usedLegalReference: true,
      };
    }

    if (input.page.legalReferenceSet.size > 0) {
      return null;
    }

    if (baseScore > 0) {
      return {
        pageNumber: input.page.pageNumber,
        score: baseScore * 0.25,
        usedLegalReference: false,
      };
    }

    return null;
  }

  if (baseScore <= 0) return null;

  return {
    pageNumber: input.page.pageNumber,
    score: baseScore,
    usedLegalReference: false,
  };
}

export function inferCitationPageFromMarkdown(input: {
  markdown: string;
  snippets: string[];
}): CitationPageInference | null {
  const pages = splitMarkdownIntoPageSlices(input.markdown);
  if (pages.length === 0) return null;

  let bestInference: CitationPageInference | null = null;

  for (const snippet of input.snippets) {
    const normalizedSnippet = normalizeCitationLookupText(snippet);
    const snippetLegalReferences = extractLegalReferenceKeys(snippet);
    if (normalizedSnippet.length < 24 && snippetLegalReferences.size === 0) {
      continue;
    }

    const snippetTokens = tokenizeCitationLookupText(snippet);
    for (const page of pages) {
      const inference = scorePageSliceForSnippet({
        page,
        normalizedSnippet,
        snippetTokens,
        snippetLegalReferences,
      });
      if (!inference) continue;
      if (!bestInference || inference.score > bestInference.score) {
        bestInference = inference;
      }
    }
  }

  return bestInference;
}
