import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { pilotChatRequestSchema } from "../../types/pilot";
import {
  buildPilotVisualFileParts,
  getPilotVisualMetadata,
  withPilotVisualContext,
} from "./visual-input";

describe("pilot visual input helpers", () => {
  it("builds file parts from an ephemeral visual context", () => {
    expect(
      buildPilotVisualFileParts({
        mode: "dom+vision",
        captures: [
          {
            kind: "viewport",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
            width: 1280,
            height: 720,
            label: "viewport.png",
          },
          {
            kind: "target-crop",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,BBBB",
            width: 640,
            height: 420,
            label: "crop.png",
          },
        ],
      }),
    ).toEqual([
      {
        type: "file",
        url: "data:image/png;base64,AAAA",
        mediaType: "image/png",
        filename: "viewport.png",
      },
      {
        type: "file",
        url: "data:image/png;base64,BBBB",
        mediaType: "image/png",
        filename: "crop.png",
      },
    ]);
  });

  it("attaches vision file parts for the model without mutating the persisted message", () => {
    const originalMessage = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Fill this form" }],
    } satisfies UIMessage;

    const modelMessage = withPilotVisualContext(originalMessage, {
      mode: "dom+vision",
      captures: [
        {
          kind: "viewport",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
          label: "viewport.png",
        },
      ],
    });

    expect(originalMessage.parts).toEqual([
      { type: "text", text: "Fill this form" },
    ]);
    expect(modelMessage.parts[0]).toEqual({
      type: "file",
      url: "data:image/png;base64,AAAA",
      mediaType: "image/png",
      filename: "viewport.png",
    });
    expect(modelMessage.parts[1]).toEqual({
      type: "text",
      text: "Fill this form",
    });
  });

  it("exposes compact visual metadata for observability", () => {
    expect(
      getPilotVisualMetadata({
        mode: "dom+vision",
        captures: [
          {
            kind: "viewport",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      }),
    ).toEqual({
      pilotVisualMode: "dom+vision",
      pilotVisualCaptureCount: 1,
    });
  });

  it("validates pageVisualContext inside the pilot chat request schema", () => {
    const parsed = pilotChatRequestSchema.parse({
      threadId: "6d8b3b4e-1c7a-4868-a55b-878d1416d53e",
      message: {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Inspect this page" }],
      },
      tabContext: {
        url: "https://example.com",
        title: "Example",
      },
      pageVisualContext: {
        mode: "dom+vision",
        captures: [
          {
            kind: "viewport",
            mediaType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
            width: 1280,
            height: 720,
          },
        ],
      },
    });

    expect(parsed.pageVisualContext?.captures).toHaveLength(1);
  });
});
