export type ImageAnalysisConfig =
  | {
      provider: string;
      model: string;
    }
  | null
  | undefined;

export type ContextImageBlock = {
  marker: string;
  index: number;
  markdown: string;
};

export type ProcessedImageAnchor = {
  pageNumber?: number | null;
  blockIndex?: number | null;
  anchorText?: string | null;
  precedingText?: string | null;
  followingText?: string | null;
  placement: "before" | "after";
  source: "dom" | "pdf-layout" | "caption" | "page-fallback";
  confidence: number;
};

export type ProcessedDocumentPage = {
  pageNumber: number;
  rawText: string;
  normalizedText: string;
  markdown: string;
  fingerprint: string;
  qualityScore: number;
  extractionMode: "raw" | "normalized" | "refined";
  repairReason?: string | null;
};

export type ProcessedDocumentImageKind = "embedded" | "region";

export type ProcessedDocumentImage = {
  kind: ProcessedDocumentImageKind;
  marker: string;
  index: number;
  buffer?: Buffer | null;
  mediaType?: string | null;
  sourceUrl?: string | null;
  storagePath?: string | null;
  pageNumber?: number | null;
  width?: number | null;
  height?: number | null;
  altText?: string | null;
  caption?: string | null;
  surroundingText?: string | null;
  precedingText?: string | null;
  followingText?: string | null;
  headingPath?: string | null;
  stepHint?: string | null;
  label: string;
  description: string;
  anchor?: ProcessedImageAnchor | null;
  isRenderable?: boolean;
  manualLabel?: boolean;
  manualDescription?: boolean;
  embedding?: number[] | null;
};

export type DocumentProcessingOptions = {
  documentTitle?: string;
  imageAnalysis?: ImageAnalysisConfig;
  imageAnalysisRequired?: boolean;
  imageNeighborContextEnabled?: boolean;
};

export type ProcessedDocument = {
  markdown: string;
  pages?: ProcessedDocumentPage[];
  imageBlocks?: ContextImageBlock[];
  images?: ProcessedDocumentImage[];
};
