export function normalizeLegalReferenceText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, "$1 $2")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function pushLegalReference(
  references: Set<string>,
  input: {
    pasal?: string | null;
    ayat?: string | null;
    huruf?: string | null;
    angka?: string | null;
  },
) {
  if (input.pasal) {
    references.add(`pasal:${input.pasal}`);
    if (input.ayat) {
      references.add(`pasal:${input.pasal}:ayat:${input.ayat}`);
    }
    if (input.huruf) {
      references.add(
        input.ayat
          ? `pasal:${input.pasal}:ayat:${input.ayat}:huruf:${input.huruf}`
          : `pasal:${input.pasal}:huruf:${input.huruf}`,
      );
    }
  }

  if (input.angka) {
    references.add(`angka:${input.angka}`);
  }
}

export function extractLegalReferenceKeys(value: string): Set<string> {
  const normalized = normalizeLegalReferenceText(value);
  if (!normalized) return new Set();

  const references = new Set<string>();

  for (const match of normalized.matchAll(
    /\bpasal\s+([0-9]{1,4}[a-z]?)(?:\s+ayat\s+([0-9]{1,4}[a-z]?))?(?:\s+huruf\s+([a-z]))?/g,
  )) {
    pushLegalReference(references, {
      pasal: match[1] ?? null,
      ayat: match[2] ?? null,
      huruf: match[3] ?? null,
    });
  }

  for (const match of normalized.matchAll(/\bangka\s+([0-9]{1,4}[a-z]?)/g)) {
    pushLegalReference(references, {
      angka: match[1] ?? null,
    });
  }

  for (const match of normalized.matchAll(/\bayat\s+([0-9]{1,4}[a-z]?)/g)) {
    references.add(`ayat:${match[1]}`);
  }

  return references;
}

export function extractPrimaryLegalReferenceKey(value: string): string | null {
  const references = extractLegalReferenceKeys(value);
  const prioritized = Array.from(references).sort((left, right) => {
    const leftRank = left.startsWith("pasal:")
      ? 0
      : left.startsWith("angka:")
        ? 1
        : 2;
    const rightRank = right.startsWith("pasal:")
      ? 0
      : right.startsWith("angka:")
        ? 1
        : 2;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });

  return prioritized[0] ?? null;
}

export function countLegalReferenceOverlap(
  left: Set<string>,
  right: Set<string>,
): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const value of left) {
    if (right.has(value)) overlap += 1;
  }
  return overlap;
}
