import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  MAX_KNOWLEDGE_IMAGE_BYTES,
  optimizeKnowledgeImageBuffer,
} from "./image-optimization";

async function createLargePngBuffer(): Promise<Buffer> {
  const width = 256;
  const height = 256;
  const raw = Buffer.alloc(width * height * 4);

  for (let index = 0; index < raw.length; index += 4) {
    const pixel = index / 4;
    raw[index] = (pixel * 17) % 256;
    raw[index + 1] = (pixel * 29) % 256;
    raw[index + 2] = (pixel * 43) % 256;
    raw[index + 3] = 255;
  }

  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 0 })
    .toBuffer();
}

describe("image-optimization", () => {
  it("shrinks oversized raster images toward the byte budget", async () => {
    const buffer = await createLargePngBuffer();
    const maxBytes = 10 * 1024;

    expect(buffer.length).toBeGreaterThan(maxBytes);

    const result = await optimizeKnowledgeImageBuffer({
      buffer,
      mediaType: "image/png",
      maxBytes,
    });

    expect(result.optimized).toBe(true);
    expect(result.buffer.length).toBeLessThanOrEqual(maxBytes);
    expect(result.buffer.length).toBeLessThan(buffer.length);
    expect(["image/jpeg", "image/webp"]).toContain(result.mediaType);
    expect(result.width).toBeTypeOf("number");
    expect(result.height).toBeTypeOf("number");
  });

  it("leaves non-raster image payloads untouched", async () => {
    const buffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );

    const result = await optimizeKnowledgeImageBuffer({
      buffer,
      mediaType: "image/svg+xml",
      maxBytes: 1,
    });

    expect(result.optimized).toBe(false);
    expect(result.buffer).toEqual(buffer);
    expect(result.mediaType).toBe("image/svg+xml");
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
  });

  it("keeps already-small images unchanged", async () => {
    const buffer = await createLargePngBuffer();

    const result = await optimizeKnowledgeImageBuffer({
      buffer,
      mediaType: "image/png",
      maxBytes: MAX_KNOWLEDGE_IMAGE_BYTES,
    });

    expect(result.optimized).toBe(false);
    expect(result.buffer).toEqual(buffer);
    expect(result.mediaType).toBe("image/png");
    expect(result.width).toBeTypeOf("number");
    expect(result.height).toBeTypeOf("number");
  });
});
