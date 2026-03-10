type PageQualityAssessment = {
  score: number;
  reasons: string[];
};

export function formatExtractedPageToMarkdown(rawText: string): string {
  if (!rawText.trim()) return "";

  const lines = rawText
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);

  const output: string[] = [];
  let prevWasShort = false;

  for (const line of lines) {
    if (/^(CTX_IMAGE_\d+|<!--CTX_PAGE:\d+-->)$/.test(line)) {
      output.push(line);
      prevWasShort = false;
      continue;
    }

    const wordCount = line.split(/\s+/).length;
    const isLikelySectionHeader =
      wordCount <= 8 &&
      !/[.!?:]$/.test(line) &&
      line.length > 2 &&
      /[A-Za-z]/.test(line);

    if (isLikelySectionHeader && prevWasShort) {
      output.push(`## ${line}`);
    } else {
      output.push(line);
    }
    prevWasShort = isLikelySectionHeader;
  }

  return output.join("\n").trim();
}

export function assessExtractedPageQuality(
  rawText: string,
  normalizedText = formatExtractedPageToMarkdown(rawText),
): PageQualityAssessment {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { score: 0, reasons: ["empty_page"] };
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { score: 0, reasons: ["empty_page"] };
  }

  const avgLineLength =
    lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const shortLineRatio =
    lines.filter((line) => line.length <= 35).length / lines.length;
  const brokenLineRatio =
    lines.filter((line) => {
      if (line.length > 80) return false;
      if (/[.!?:]$/.test(line)) return false;
      return /[A-Za-z0-9]$/.test(line);
    }).length / lines.length;
  const nonTextChars = trimmed.replace(
    /[A-Za-z0-9\s.,;:!?()[\]{}%$#@'"`/_-]/g,
    "",
  );
  const noiseRatio = nonTextChars.length / Math.max(trimmed.length, 1);
  const headingCount = normalizedText
    .split("\n")
    .filter((line) => /^#{1,6}\s+/.test(line.trim())).length;

  let score = 1;
  const reasons: string[] = [];

  if (avgLineLength < 32) {
    score -= 0.2;
    reasons.push("short_lines");
  }
  if (shortLineRatio > 0.55) {
    score -= 0.2;
    reasons.push("fragmented_lines");
  }
  if (brokenLineRatio > 0.5) {
    score -= 0.2;
    reasons.push("broken_reading_order");
  }
  if (noiseRatio > 0.12) {
    score -= 0.2;
    reasons.push("ocr_noise");
  }
  if (lines.length >= 20 && headingCount === 0) {
    score -= 0.1;
    reasons.push("low_structure");
  }
  if (/\s{3,}/.test(trimmed) || /\t/.test(trimmed)) {
    score -= 0.1;
    reasons.push("column_layout");
  }

  return {
    score: Math.max(0, Number(score.toFixed(2))),
    reasons,
  };
}
