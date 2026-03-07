import { UploadedFile } from "@/app/store";
import { ChatMention } from "app-types/chat";
import { UIMessage } from "ai";

const CHARS_PER_TOKEN = 4;
const INLINE_BINARY_PLACEHOLDER = "[inline-binary]";

interface EstimateChatContextTokensInput {
  messages?: UIMessage[];
  mentions?: ChatMention[];
  uploadedFiles?: Pick<
    UploadedFile,
    "name" | "mimeType" | "size" | "isUploading"
  >[];
  extraContext?: string;
}

export function estimatePromptTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  return Math.ceil(normalized.length / CHARS_PER_TOKEN);
}

export function estimateChatContextTokens(
  input: EstimateChatContextTokensInput,
): number {
  const sections = [
    serializeMessages(input.messages ?? []),
    serializeMentions(input.mentions ?? []),
    serializeUploadedFiles(input.uploadedFiles ?? []),
    input.extraContext?.trim()
      ? `Additional context:\n${input.extraContext.trim()}`
      : "",
  ].filter(Boolean);

  return estimatePromptTokens(sections.join("\n\n"));
}

function serializeMessages(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const parts = Array.isArray(message.parts)
        ? message.parts
            .map((part) => serializeUnknown(part))
            .filter((value) => value.length > 0)
        : [];

      const fallback = getMessageFallbackContent(message);
      const content = parts.length > 0 ? parts.join("\n\n") : fallback;
      if (!content.trim()) return "";

      return `${message.role}:\n${content}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function getMessageFallbackContent(message: UIMessage): string {
  const maybeContent = (message as { content?: unknown }).content;
  return typeof maybeContent === "string" ? maybeContent : "";
}

function serializeMentions(mentions: ChatMention[]): string {
  if (!mentions.length) return "";

  const lines = mentions.map((mention) => {
    const identifier =
      mention.type === "agent"
        ? mention.agentId
        : mention.type === "workflow"
          ? mention.workflowId
          : mention.type === "knowledge"
            ? mention.knowledgeId
            : mention.type === "mcpServer" || mention.type === "mcpTool"
              ? mention.serverId
              : mention.name;

    return [mention.type, mention.name, mention.description ?? "", identifier]
      .filter(Boolean)
      .join(" ");
  });

  return `Mentions:\n${lines.join("\n")}`;
}

function serializeUploadedFiles(
  uploadedFiles: Pick<
    UploadedFile,
    "name" | "mimeType" | "size" | "isUploading"
  >[],
): string {
  if (!uploadedFiles.length) return "";

  const lines = uploadedFiles.map((file) =>
    [
      file.name,
      file.mimeType,
      file.size ? `${file.size} bytes` : "",
      file.isUploading ? "uploading" : "ready",
    ]
      .filter(Boolean)
      .join(" "),
  );

  return `Pending files:\n${lines.join("\n")}`;
}

function serializeUnknown(
  value: unknown,
  seen = new WeakSet<object>(),
): string {
  if (value === null || value === undefined) return "";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return sanitizeScalar(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => serializeUnknown(item, seen))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") return "";

  if (seen.has(value)) return "[circular]";
  seen.add(value);

  return Object.entries(value)
    .filter(([, entry]) => entry !== undefined && typeof entry !== "function")
    .map(([key, entry]) => {
      const serialized = serializeUnknown(entry, seen);
      return serialized ? `${key}: ${serialized}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function sanitizeScalar(value: string): string {
  if (value.startsWith("data:")) {
    return INLINE_BINARY_PLACEHOLDER;
  }

  return value;
}
