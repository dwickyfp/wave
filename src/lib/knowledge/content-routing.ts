import type {
  DocumentFileType,
  KnowledgeChunkContentKind,
  KnowledgeChunkMetadata,
} from "app-types/knowledge";

const CODE_EXTENSION_MAP: Record<string, string> = {
  cjs: "javascript",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  go: "go",
  java: "java",
  js: "javascript",
  jsx: "jsx",
  kt: "kotlin",
  mdx: "mdx",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const MIME_TO_TYPE: Record<string, DocumentFileType> = {
  "application/json": "json",
  "application/pdf": "pdf",
  "application/vnd.ms-outlook": "eml",
  "application/vnd.ms-powerpoint": "pptx",
  "application/vnd.ms-excel": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/xml": "code",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "message/rfc822": "eml",
  "text/csv": "csv",
  "text/html": "html",
  "text/markdown": "md",
  "text/plain": "txt",
  "text/x-python": "code",
  "text/xml": "code",
};

const EXTENSION_TO_TYPE: Record<string, DocumentFileType> = {
  csv: "csv",
  docx: "docx",
  eml: "eml",
  htm: "html",
  html: "html",
  gif: "gif",
  jpeg: "jpeg",
  jpg: "jpg",
  json: "json",
  md: "md",
  markdown: "md",
  msg: "eml",
  pdf: "pdf",
  png: "png",
  pptx: "pptx",
  txt: "txt",
  url: "url",
  webp: "webp",
  xls: "xlsx",
  xlsx: "xlsx",
  xml: "code",
  yaml: "code",
  yml: "code",
  ...Object.fromEntries(
    Object.keys(CODE_EXTENSION_MAP).map((extension) => [extension, "code"]),
  ),
};

function getExtension(filename?: string | null): string {
  const trimmed = filename?.trim().toLowerCase() ?? "";
  const parts = trimmed.split(".");
  return parts.length > 1 ? (parts.at(-1) ?? "") : "";
}

export function resolveDocumentFileType(input: {
  filename?: string | null;
  mimeType?: string | null;
}): DocumentFileType {
  const mime = input.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const ext = getExtension(input.filename);
  return MIME_TO_TYPE[mime] ?? EXTENSION_TO_TYPE[ext] ?? "txt";
}

export function resolveContentKind(
  fileType: DocumentFileType,
): KnowledgeChunkContentKind {
  switch (fileType) {
    case "url":
    case "html":
      return "web";
    case "md":
      return "markdown";
    case "json":
      return "json";
    case "eml":
      return "email";
    case "pptx":
      return "presentation";
    case "xlsx":
    case "csv":
      return "spreadsheet";
    case "code":
      return "code";
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "pdf":
    case "docx":
    case "txt":
    default:
      return "document";
  }
}

export function detectCodeLanguage(filename?: string | null): string | null {
  const ext = getExtension(filename);
  return CODE_EXTENSION_MAP[ext] ?? null;
}

export function detectChunkLanguage(input: {
  fileType: DocumentFileType;
  originalFilename?: string | null;
  content?: string | null;
}): string | null {
  if (input.fileType === "json") return "json";
  if (input.fileType === "eml") return "email";
  if (input.fileType === "md") return "markdown";
  if (input.fileType === "html" || input.fileType === "url") return "html";

  const byFilename = detectCodeLanguage(input.originalFilename);
  if (byFilename) return byFilename;

  const sample = input.content?.slice(0, 1000) ?? "";
  if (!sample) return null;
  if (/^\s*[{[]/m.test(sample)) return "json";
  if (/^\s*(import |export |const |let |function |class )/m.test(sample)) {
    return "javascript";
  }
  if (/^\s*(def |class |from .* import |import )/m.test(sample)) {
    return "python";
  }
  if (/^\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/im.test(sample)) {
    return "sql";
  }
  return null;
}

export function buildTemporalHints(input: {
  periodEnd?: string | null;
  effectiveAt?: string | null;
  freshnessLabel?: string | null;
}): KnowledgeChunkMetadata["temporalHints"] {
  const effectiveAt = input.effectiveAt ?? input.periodEnd ?? null;
  if (!effectiveAt && !input.freshnessLabel) return null;
  return {
    effectiveAt,
    expiresAt: null,
    freshnessLabel: input.freshnessLabel ?? null,
  };
}
