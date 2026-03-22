import {
  sanitizeFilename,
  sanitizePathSegment,
  sanitizeStoragePath,
} from "./path-utils";

export const USER_UPLOAD_NAMESPACE = "user-content";
export const MAX_USER_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_KNOWLEDGE_DOCUMENT_BYTES = 25 * 1024 * 1024;

export const USER_UPLOAD_ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/csv",
  "application/csv",
  "text/plain",
  "text/markdown",
] as const;

const userUploadAllowedContentTypeSet = new Set(
  USER_UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[],
);

const normalizeContentType = (contentType?: string) =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase();

const normalizeUserId = (userId: string) => sanitizePathSegment(userId);
const normalizeResourceId = (value: string | number) =>
  sanitizePathSegment(String(value));

export type UserStorageSection = "chat" | "pilot" | "profile" | "knowledge";
export type UserStorageContextType =
  | "thread-inputs"
  | "generated-images"
  | "context-inputs"
  | "avatar-uploads"
  | "generated-avatars"
  | "documents"
  | "document-images";

type UserScopedObjectPathOptions = {
  userId: string;
  section: UserStorageSection | string;
  contextType: UserStorageContextType | string;
  filename: string;
  resourceIds?: Array<string | number | null | undefined>;
};

const normalizeResourceIds = (
  resourceIds: UserScopedObjectPathOptions["resourceIds"] = [],
) =>
  resourceIds
    .filter(
      (resourceId): resourceId is string | number =>
        resourceId !== null &&
        resourceId !== undefined &&
        String(resourceId).trim().length > 0,
    )
    .map(normalizeResourceId);

export function buildUserScopedObjectPath(
  options: UserScopedObjectPathOptions,
) {
  return [
    USER_UPLOAD_NAMESPACE,
    normalizeUserId(options.userId),
    sanitizePathSegment(options.section),
    sanitizePathSegment(options.contextType),
    ...normalizeResourceIds(options.resourceIds),
    sanitizeFilename(options.filename || "file"),
  ].join("/");
}

export function buildChatThreadUploadPath(input: {
  userId: string;
  threadId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "chat",
    contextType: "thread-inputs",
    resourceIds: [input.threadId],
    filename: input.filename,
  });
}

export function buildChatGeneratedImageUploadPath(input: {
  userId: string;
  threadId?: string | null;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "chat",
    contextType: "generated-images",
    resourceIds: [input.threadId],
    filename: input.filename,
  });
}

export function buildPilotContextUploadPath(input: {
  userId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "pilot",
    contextType: "context-inputs",
    filename: input.filename,
  });
}

export function buildUserAvatarUploadPath(input: {
  userId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "profile",
    contextType: "avatar-uploads",
    filename: input.filename,
  });
}

export function buildGeneratedAvatarUploadPath(input: {
  userId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "profile",
    contextType: "generated-avatars",
    filename: input.filename,
  });
}

export function buildKnowledgeDocumentUploadPath(input: {
  userId: string;
  groupId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "knowledge",
    contextType: "documents",
    resourceIds: [input.groupId],
    filename: input.filename,
  });
}

export function buildKnowledgeDocumentImageUploadPath(input: {
  userId: string;
  groupId: string;
  documentId: string;
  versionId: string;
  filename: string;
}) {
  return buildUserScopedObjectPath({
    userId: input.userId,
    section: "knowledge",
    contextType: "document-images",
    resourceIds: [input.groupId, input.documentId, input.versionId],
    filename: input.filename,
  });
}

export class StorageUploadPolicyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "StorageUploadPolicyError";
  }
}

export function isAllowedUserUploadContentType(contentType?: string) {
  const normalized = normalizeContentType(contentType);
  return !!normalized && userUploadAllowedContentTypeSet.has(normalized);
}

export function assertAllowedUserUpload(options: {
  contentType?: string;
  size: number;
}) {
  if (!isAllowedUserUploadContentType(options.contentType)) {
    throw new StorageUploadPolicyError("Unsupported file type for upload", 400);
  }

  if (options.size > MAX_USER_UPLOAD_BYTES) {
    throw new StorageUploadPolicyError(
      `File too large. Maximum size is ${Math.round(
        MAX_USER_UPLOAD_BYTES / (1024 * 1024),
      )}MB`,
      413,
    );
  }
}

export function assertKnowledgeDocumentSize(size: number) {
  if (size > MAX_KNOWLEDGE_DOCUMENT_BYTES) {
    throw new StorageUploadPolicyError(
      `Document too large. Maximum size is ${Math.round(
        MAX_KNOWLEDGE_DOCUMENT_BYTES / (1024 * 1024),
      )}MB`,
      413,
    );
  }
}

export function buildUserScopedUploadPath(userId: string, pathname: string) {
  return [
    USER_UPLOAD_NAMESPACE,
    normalizeUserId(userId),
    sanitizeStoragePath(pathname || "file"),
  ].join("/");
}

export function assertUserScopedUploadPath(userId: string, pathname: string) {
  const normalizedPath = sanitizeStoragePath(pathname || "file");
  const userSegment = normalizeUserId(userId);
  const expectedPrefix = `${USER_UPLOAD_NAMESPACE}/${userSegment}/`;

  if (!normalizedPath.startsWith(expectedPrefix)) {
    throw new StorageUploadPolicyError(
      "Upload path does not belong to the current user",
      403,
    );
  }

  return normalizedPath;
}

export function resolveUserScopedUploadPath(userId: string, pathname: string) {
  const normalizedPath = sanitizeStoragePath(pathname || "file");
  const segments = normalizedPath.split("/");

  if (segments.includes(USER_UPLOAD_NAMESPACE)) {
    return assertUserScopedUploadPath(userId, normalizedPath);
  }

  return buildUserScopedUploadPath(userId, normalizedPath);
}

export function isUserOwnedStorageKey(key: string, userId: string) {
  const normalizedPath = sanitizeStoragePath(decodeURIComponent(key));
  const userSegment = normalizeUserId(userId);
  const segments = normalizedPath.split("/");
  const namespaceIndex = segments.indexOf(USER_UPLOAD_NAMESPACE);

  if (namespaceIndex === -1) {
    return false;
  }

  return segments[namespaceIndex + 1] === userSegment;
}
