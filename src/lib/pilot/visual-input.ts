import type { UIMessage } from "ai";
import type { PilotVisualContext } from "../../types/pilot";

type PilotVisualFilePart = Extract<
  UIMessage["parts"][number],
  { type: "file" }
>;

export function buildPilotVisualFileParts(
  pageVisualContext?: PilotVisualContext,
): PilotVisualFilePart[] {
  if (
    !pageVisualContext ||
    pageVisualContext.mode !== "dom+vision" ||
    !pageVisualContext.captures.length
  ) {
    return [];
  }

  return pageVisualContext.captures.map((capture, index) => ({
    type: "file",
    url: capture.dataUrl,
    mediaType: capture.mediaType,
    filename:
      capture.label ||
      `emma-pilot-${capture.kind}-${String(index + 1).padStart(2, "0")}.png`,
  }));
}

export function withPilotVisualContext(
  message: UIMessage,
  pageVisualContext?: PilotVisualContext,
): UIMessage {
  const visualParts = buildPilotVisualFileParts(pageVisualContext);
  if (!visualParts.length) {
    return message;
  }

  return {
    ...message,
    parts: [...visualParts, ...message.parts],
  };
}

export function getPilotVisualMetadata(pageVisualContext?: PilotVisualContext) {
  return {
    pilotVisualMode: pageVisualContext?.mode ?? "dom-only",
    pilotVisualCaptureCount: pageVisualContext?.captures.length ?? 0,
  } as const;
}
