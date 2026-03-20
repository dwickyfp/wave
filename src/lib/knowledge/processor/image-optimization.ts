import sharp from "sharp";

export const MAX_KNOWLEDGE_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_QUALITY_STEPS = [82, 72, 62, 52, 42] as const;
const IMAGE_SCALE_STEPS = [1, 0.85, 0.7, 0.55, 0.4] as const;
const MIN_OPTIMIZED_WIDTH = 512;

type OptimizedImageInput = {
  buffer: Buffer;
  mediaType?: string | null;
  maxBytes?: number;
};

type OptimizedImageResult = {
  buffer: Buffer;
  mediaType: string | null;
  width: number | null;
  height: number | null;
  optimized: boolean;
};

function normalizeMediaType(mediaType?: string | null): string | null {
  return mediaType?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

function isOptimizableRasterImage(mediaType?: string | null): boolean {
  const normalized = normalizeMediaType(mediaType);
  if (!normalized?.startsWith("image/")) return false;
  return normalized !== "image/svg+xml";
}

function getOutputFormat(hasAlpha: boolean): "jpeg" | "webp" {
  return hasAlpha ? "webp" : "jpeg";
}

function getOutputMediaType(format: "jpeg" | "webp"): string {
  return format === "webp" ? "image/webp" : "image/jpeg";
}

function getTargetWidth(
  sourceWidth: number | null,
  scale: number,
): number | undefined {
  if (!sourceWidth || !Number.isFinite(sourceWidth)) {
    return undefined;
  }

  const scaledWidth = Math.floor(sourceWidth * scale);
  if (scaledWidth >= sourceWidth) {
    return undefined;
  }

  return Math.max(MIN_OPTIMIZED_WIDTH, scaledWidth);
}

export async function optimizeKnowledgeImageBuffer({
  buffer,
  mediaType,
  maxBytes = MAX_KNOWLEDGE_IMAGE_BYTES,
}: OptimizedImageInput): Promise<OptimizedImageResult> {
  const normalizedMediaType = normalizeMediaType(mediaType);

  if (!buffer.length || !isOptimizableRasterImage(normalizedMediaType)) {
    return {
      buffer,
      mediaType: normalizedMediaType,
      width: null,
      height: null,
      optimized: false,
    };
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? null;
    const height = metadata.height ?? null;

    if (buffer.length <= maxBytes) {
      return {
        buffer,
        mediaType: normalizedMediaType,
        width,
        height,
        optimized: false,
      };
    }

    if ((metadata.pages ?? 1) > 1) {
      return {
        buffer,
        mediaType: normalizedMediaType,
        width,
        height,
        optimized: false,
      };
    }

    const outputFormat = getOutputFormat(Boolean(metadata.hasAlpha));
    const outputMediaType = getOutputMediaType(outputFormat);

    let smallestResult: OptimizedImageResult = {
      buffer,
      mediaType: normalizedMediaType,
      width,
      height,
      optimized: false,
    };

    for (const scale of IMAGE_SCALE_STEPS) {
      const targetWidth = getTargetWidth(width, scale);

      for (const quality of IMAGE_QUALITY_STEPS) {
        let pipeline = sharp(buffer).rotate();

        if (targetWidth) {
          pipeline = pipeline.resize({
            width: targetWidth,
            withoutEnlargement: true,
          });
        }

        pipeline =
          outputFormat === "webp"
            ? pipeline.webp({ quality, effort: 4 })
            : pipeline.jpeg({ quality, mozjpeg: true });

        const candidate = await pipeline.toBuffer({ resolveWithObject: true });
        const candidateResult: OptimizedImageResult = {
          buffer: candidate.data,
          mediaType: outputMediaType,
          width: candidate.info.width ?? targetWidth ?? width,
          height: candidate.info.height ?? height,
          optimized: true,
        };

        if (candidateResult.buffer.length < smallestResult.buffer.length) {
          smallestResult = candidateResult;
        }

        if (candidateResult.buffer.length <= maxBytes) {
          return candidateResult;
        }
      }
    }

    return smallestResult;
  } catch (error) {
    console.warn("[ContextX] Failed to optimize extracted image:", error);
    return {
      buffer,
      mediaType: normalizedMediaType,
      width: null,
      height: null,
      optimized: false,
    };
  }
}
