import { describe, expect, it } from "vitest";
import { storageKeyFromUrl } from "./storage-utils";
import {
  buildChatThreadUploadPath,
  buildKnowledgeDocumentImageUploadPath,
  buildUserScopedUploadPath,
  isUserOwnedStorageKey,
  resolveUserScopedUploadPath,
} from "./upload-policy";

describe("storageKeyFromUrl", () => {
  it("extracts key from absolute URL", () => {
    expect(storageKeyFromUrl("https://example.com/uploads/sample.csv")).toBe(
      "uploads/sample.csv",
    );
  });

  it("decodes encoded path segments", () => {
    expect(
      storageKeyFromUrl(
        "https://example.com/uploads/My%20File%20(1).csv?token=123",
      ),
    ).toBe("uploads/My File (1).csv");
  });

  it("returns null for invalid URLs", () => {
    expect(storageKeyFromUrl("not-a-url")).toBeNull();
  });
});

describe("upload ownership helpers", () => {
  it("builds user-scoped upload paths", () => {
    expect(buildUserScopedUploadPath("user-1", "avatar/profile.png")).toBe(
      "user-content/user-1/avatar/profile.png",
    );
  });

  it("builds structured chat upload paths", () => {
    expect(
      buildChatThreadUploadPath({
        userId: "user-1",
        threadId: "thread-1",
        filename: "report.csv",
      }),
    ).toBe("user-content/user-1/chat/thread-inputs/thread-1/report.csv");
  });

  it("builds structured knowledge image paths", () => {
    expect(
      buildKnowledgeDocumentImageUploadPath({
        userId: "user-1",
        groupId: "group-1",
        documentId: "doc-1",
        versionId: "version-1",
        filename: "image-1.png",
      }),
    ).toBe(
      "user-content/user-1/knowledge/document-images/group-1/doc-1/version-1/image-1.png",
    );
  });

  it("accepts already scoped paths for the same user", () => {
    expect(
      resolveUserScopedUploadPath(
        "user-1",
        "user-content/user-1/chat/thread-inputs/thread-1/report.csv",
      ),
    ).toBe("user-content/user-1/chat/thread-inputs/thread-1/report.csv");
  });

  it("scopes plain filenames to the current user", () => {
    expect(resolveUserScopedUploadPath("user-1", "profile.png")).toBe(
      "user-content/user-1/profile.png",
    );
  });

  it("recognizes ownership for structured keys", () => {
    expect(
      isUserOwnedStorageKey(
        "uploads/user-content/user-1/knowledge/documents/group-1/report.pdf",
        "user-1",
      ),
    ).toBe(true);
  });

  it("rejects keys owned by a different user", () => {
    expect(
      isUserOwnedStorageKey(
        "uploads/user-content/user-2/chat/thread-inputs/thread-1/report.csv",
        "user-1",
      ),
    ).toBe(false);
  });
});
