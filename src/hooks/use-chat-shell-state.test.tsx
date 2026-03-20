import { appStore } from "@/app/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildActiveChatShellState,
  buildInactiveChatShellState,
} from "./use-chat-shell-state";

vi.mock("server-only", () => ({}));

describe("useChatShellState", () => {
  const muteConsole = () => {};

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(muteConsole);
    vi.spyOn(console, "warn").mockImplementation(muteConsole);
    appStore.setState({
      currentThreadId: null,
      citationDocumentPreview: {
        documentId: "doc-1",
        groupId: "group-1",
        documentName: "Quarterly Report",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("tracks the active thread and closes stale citation previews", () => {
    appStore.getState().mutate(buildActiveChatShellState("thread-1"));

    expect(appStore.getState().currentThreadId).toBe("thread-1");
    expect(appStore.getState().citationDocumentPreview).toBeNull();

    appStore.getState().mutate({
      citationDocumentPreview: {
        documentId: "doc-2",
        groupId: "group-2",
        documentName: "Annual Summary",
      },
    });
    appStore.getState().mutate(buildActiveChatShellState("thread-2"));

    expect(appStore.getState().currentThreadId).toBe("thread-2");
    expect(appStore.getState().citationDocumentPreview).toBeNull();

    appStore.getState().mutate({
      citationDocumentPreview: {
        documentId: "doc-3",
        groupId: "group-3",
        documentName: "PDF Preview",
      },
    });
    appStore.getState().mutate(buildInactiveChatShellState());

    expect(appStore.getState().currentThreadId).toBeNull();
    expect(appStore.getState().citationDocumentPreview).toBeNull();
  });
});
