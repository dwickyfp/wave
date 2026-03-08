import { describe, expect, it } from "vitest";
import type { PilotModelProvider } from "../../../src/types/pilot";
import {
  buildImageRedactionRects,
  clampRectToViewport,
  mapRectToImagePixels,
  supportsPilotVision,
} from "./visual-context";

const providers: PilotModelProvider[] = [
  {
    provider: "openrouter",
    hasAPIKey: true,
    models: [
      {
        name: "Vision",
        contextLength: 128000,
        supportsGeneration: true,
        isToolCallUnsupported: false,
        isImageInputUnsupported: false,
        supportedFileMimeTypes: ["image/png"],
      },
      {
        name: "No Vision",
        contextLength: 128000,
        supportsGeneration: true,
        isToolCallUnsupported: false,
        isImageInputUnsupported: true,
        supportedFileMimeTypes: [],
      },
    ],
  },
];

describe("pilot visual context helpers", () => {
  it("detects whether the selected model supports image input", () => {
    expect(
      supportsPilotVision(providers, {
        provider: "openrouter",
        model: "Vision",
      }),
    ).toBe(true);
    expect(
      supportsPilotVision(providers, {
        provider: "openrouter",
        model: "No Vision",
      }),
    ).toBe(false);
  });

  it("clamps crop rectangles to the visible viewport", () => {
    expect(
      clampRectToViewport(
        {
          x: -40,
          y: 12,
          width: 140,
          height: 120,
        },
        {
          innerWidth: 100,
          innerHeight: 80,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
        },
      ),
    ).toEqual({
      x: 0,
      y: 12,
      width: 100,
      height: 68,
    });
  });

  it("maps DOM viewport rectangles into screenshot pixels", () => {
    expect(
      mapRectToImagePixels({
        rect: {
          x: 20,
          y: 10,
          width: 60,
          height: 30,
        },
        viewport: {
          innerWidth: 100,
          innerHeight: 50,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
        },
        imageWidth: 200,
        imageHeight: 100,
      }),
    ).toEqual({
      x: 40,
      y: 20,
      width: 120,
      height: 60,
    });
  });

  it("builds redaction rectangles for sensitive regions and crop views", () => {
    const redactions = buildImageRedactionRects({
      snapshot: {
        url: "https://example.com",
        title: "Example",
        visibleText: "",
        forms: [],
        standaloneFields: [],
        actionables: [],
        viewport: {
          innerWidth: 100,
          innerHeight: 100,
          scrollX: 0,
          scrollY: 0,
          devicePixelRatio: 2,
        },
        sensitiveFieldRects: [
          {
            elementId: "password",
            rect: {
              x: 20,
              y: 30,
              width: 40,
              height: 20,
            },
          },
        ],
      },
      imageWidth: 200,
      imageHeight: 200,
      clipRect: {
        x: 30,
        y: 40,
        width: 90,
        height: 80,
      },
    });

    expect(redactions).toEqual([
      {
        x: 10,
        y: 20,
        width: 80,
        height: 40,
      },
    ]);
  });
});
