import { describe, expect, it } from "vitest";
import { resolveDocumentFileType } from "./content-routing";

describe("content-routing", () => {
  it("resolves common image mime types as standalone image documents", () => {
    expect(
      resolveDocumentFileType({
        filename: "diagram.jpg",
        mimeType: "image/jpeg",
      }),
    ).toBe("jpg");
    expect(
      resolveDocumentFileType({
        filename: "diagram.jpeg",
        mimeType: "image/jpg",
      }),
    ).toBe("jpg");
    expect(
      resolveDocumentFileType({
        filename: "diagram.png",
        mimeType: "image/png",
      }),
    ).toBe("png");
    expect(
      resolveDocumentFileType({
        filename: "diagram.webp",
        mimeType: "image/webp",
      }),
    ).toBe("webp");
    expect(
      resolveDocumentFileType({
        filename: "diagram.gif",
        mimeType: "image/gif",
      }),
    ).toBe("gif");
  });

  it("falls back to image extensions when the browser does not send a mime type", () => {
    expect(
      resolveDocumentFileType({
        filename: "diagram.JPG",
      }),
    ).toBe("jpg");
    expect(
      resolveDocumentFileType({
        filename: "diagram.JPEG",
      }),
    ).toBe("jpeg");
    expect(
      resolveDocumentFileType({
        filename: "diagram.PNG",
      }),
    ).toBe("png");
  });
});
