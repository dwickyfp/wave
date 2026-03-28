import type { DocumentFileType } from "app-types/knowledge";
import {
  createContextImageMarker,
  generateContextImageArtifacts,
} from "./image-markdown";
import type { DocumentProcessingOptions, ProcessedDocument } from "./types";

const IMAGE_FILE_MEDIA_TYPES: Record<
  Extract<DocumentFileType, "png" | "jpg" | "jpeg" | "gif" | "webp">,
  string
> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function processImageFile(
  fileType: Extract<DocumentFileType, "png" | "jpg" | "jpeg" | "gif" | "webp">,
  input: Buffer,
  options: DocumentProcessingOptions = {},
): Promise<ProcessedDocument> {
  const documentTitle =
    options.documentTitle ?? options.originalFilename ?? "Image document";
  const marker = createContextImageMarker(1);
  const images = await generateContextImageArtifacts(
    [
      {
        index: 1,
        marker,
        buffer: input,
        mediaType: IMAGE_FILE_MEDIA_TYPES[fileType],
        pageNumber: 1,
      },
    ],
    {
      ...options,
      documentTitle,
      imageAnalysisRequired: true,
      imageMode: "always",
      imageNeighborContextEnabled: false,
    },
  );

  return {
    markdown: `# ${documentTitle}\n\n${marker}`,
    images,
  };
}
