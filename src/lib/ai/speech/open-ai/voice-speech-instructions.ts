export function buildSpeechInstructions(text: string) {
  return [
    "Create an out-of-band audio-only response.",
    "Say exactly the text inside <speak> and </speak>.",
    "Do not answer the user.",
    "Do not add, remove, paraphrase, summarize, translate, or reorder any words.",
    "",
    "<speak>",
    text.trim(),
    "</speak>",
  ].join("\n");
}
