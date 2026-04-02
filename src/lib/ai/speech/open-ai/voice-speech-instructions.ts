const APOLOGY_OR_RESOLUTION_PATTERN =
  /\b(apolog(?:y|ize|ise|ized|ised|izing|ising)?|sorry|refund|patience|maaf|pengembalian|kesabaran|solusi|terima kasih)\b/i;

export function buildSpeechStyleInstructions(text: string) {
  const instructions = [
    "Voice Affect: Calm, composed, and reassuring. Competent and in control, instilling trust.",
    "Tone: Sincere, empathetic, and professional.",
    "Emotions: Calm reassurance, empathy, and gratitude.",
    "Pronunciation: Clear and precise, especially for names, numbers, and key details.",
  ];

  if (APOLOGY_OR_RESOLUTION_PATTERN.test(text)) {
    instructions.push(
      "Pacing: Slightly slower around apologies or sensitive details. Slightly faster when offering solutions or next steps.",
      "Pauses: Use a brief natural pause before and after an apology.",
    );
  }

  return instructions.join("\n\n");
}

export function buildSpeechInstructions(text: string) {
  return [
    "You are speaking inside a live voice call.",
    "Read the provided text aloud exactly as written.",
    "Do not answer the user.",
    "Do not translate.",
    "Do not add, remove, summarize, paraphrase, or reorder any words.",
    "Keep the original language, wording, names, and punctuation intent.",
    "Apply the speaking style only if it does not change the words.",
    buildSpeechStyleInstructions(text),
    "",
    text,
  ].join("\n\n");
}
