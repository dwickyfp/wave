const VOICE_VIBE_INSTRUCTIONS = `
Voice Affect: Calm, composed, and reassuring. Competent and in control, instilling trust.

Tone: Sincere, empathetic, with genuine concern for the customer and understanding of the situation.

Pacing: Slower during the apology to allow for clarity and processing. Faster when offering solutions to signal action and resolution.

Emotions: Calm reassurance, empathy, and gratitude.

Pronunciation: Clear, precise. Ensure clarity, especially with key details. Focus on key words like "refund" and "patience."

Pauses: Use a brief pause before and after the apology to give space for processing the apology.
`.trim();

export function buildSpeechInstructions(text: string) {
  return [
    "You are speaking inside a live voice call.",
    VOICE_VIBE_INSTRUCTIONS,
    "Say exactly the provided text out loud.",
    "Do not add, remove, summarize, or paraphrase any words.",
    "",
    text,
  ].join("\n\n");
}
