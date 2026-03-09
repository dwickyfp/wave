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

export type DocumentProcessingOptions = {
  documentTitle?: string;
  imageAnalysis?: ImageAnalysisConfig;
};

export type ProcessedDocument = {
  markdown: string;
  imageBlocks?: ContextImageBlock[];
};
