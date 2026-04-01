const SHORT_AUTO_RESUME_TRANSCRIPT_MAX_DURATION_MS = 1_600;

function getSpeechWords(text: string) {
  return Array.from(
    new Set(
      normalizeSpeechForEchoGuard(text)
        .split(" ")
        .filter((word) => word.length > 1),
    ),
  );
}

function getSpeechWordOverlap(transcript: string, assistantText: string) {
  const transcriptWords = getSpeechWords(transcript);
  const assistantWords = new Set(getSpeechWords(assistantText));

  return {
    transcriptWords,
    overlapCount: transcriptWords.filter((word) => assistantWords.has(word))
      .length,
  };
}

export function normalizeSpeechForEchoGuard(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isLikelyEchoTranscript(
  transcript: string,
  assistantText: string,
) {
  const normalizedTranscript = normalizeSpeechForEchoGuard(transcript);
  const normalizedAssistant = normalizeSpeechForEchoGuard(assistantText);

  if (!normalizedTranscript || !normalizedAssistant) {
    return false;
  }

  if (
    normalizedAssistant.includes(normalizedTranscript) ||
    normalizedTranscript.includes(normalizedAssistant)
  ) {
    return true;
  }

  const { transcriptWords, overlapCount } = getSpeechWordOverlap(
    transcript,
    assistantText,
  );

  if (!transcriptWords.length) {
    return false;
  }

  if (transcriptWords.length === 1) {
    return overlapCount === 1;
  }

  if (transcriptWords.length === 2) {
    return overlapCount === 2;
  }

  if (transcriptWords.length === 3) {
    return overlapCount >= 2;
  }

  return overlapCount / transcriptWords.length >= 0.7;
}

export function isLikelyGhostTranscript(
  transcript: string,
  {
    maxChars,
    maxWords,
  }: {
    maxChars: number;
    maxWords: number;
  },
) {
  const normalized = normalizeSpeechForEchoGuard(transcript);
  if (!normalized) {
    return false;
  }

  const words = normalized.split(" ").filter(Boolean);
  if (normalized.length > maxChars || words.length > maxWords) {
    return false;
  }

  return new Set(words).size <= 1;
}

export function shouldIgnoreShortAutoResumeTranscript({
  transcript,
  assistantText,
  speechDurationMs,
}: {
  transcript: string;
  assistantText: string;
  speechDurationMs: number;
}) {
  if (speechDurationMs > SHORT_AUTO_RESUME_TRANSCRIPT_MAX_DURATION_MS) {
    return false;
  }

  const { transcriptWords, overlapCount } = getSpeechWordOverlap(
    transcript,
    assistantText,
  );

  if (!transcriptWords.length) {
    return true;
  }

  if (transcriptWords.length === 1) {
    return true;
  }

  if (transcriptWords.length === 2) {
    return overlapCount === 2;
  }

  if (transcriptWords.length === 3) {
    return overlapCount >= 2;
  }

  return false;
}
