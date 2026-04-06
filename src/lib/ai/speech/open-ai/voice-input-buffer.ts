export const VOICE_MIN_COMMIT_AUDIO_MS = 100;

export function getVoiceInputBufferAction(input: {
  bufferedSamples: number;
  sampleRate: number;
}) {
  const minimumSamples = Math.ceil(
    (VOICE_MIN_COMMIT_AUDIO_MS / 1000) * input.sampleRate,
  );

  return input.bufferedSamples >= minimumSamples ? "commit" : "clear";
}
