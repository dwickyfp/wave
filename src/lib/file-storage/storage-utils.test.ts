import { describe, expect, it } from "vitest";
import { storageKeyFromUrl } from "./storage-utils";
import {
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

  it("accepts already scoped paths for the same user", () => {
    expect(
      resolveUserScopedUploadPath(
        "user-1",
        "user-content/user-1/avatar/profile.png",
      ),
    ).toBe("user-content/user-1/avatar/profile.png");
  });

  it("scopes plain filenames to the current user", () => {
    expect(resolveUserScopedUploadPath("user-1", "profile.png")).toBe(
      "user-content/user-1/profile.png",
    );
  });

  it("rejects keys owned by a different user", () => {
    expect(
      isUserOwnedStorageKey(
        "uploads/user-content/user-2/avatar/profile.png",
        "user-1",
      ),
    ).toBe(false);
  });
});
