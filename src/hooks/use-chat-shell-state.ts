"use client";

import type { AppState } from "@/app/store";
import { appStore } from "@/app/store";
import { useEffect } from "react";

type ChatShellStatePatch = Pick<
  AppState,
  "currentThreadId" | "citationDocumentPreview"
>;

export function buildActiveChatShellState(
  threadId: string,
): ChatShellStatePatch {
  return {
    currentThreadId: threadId,
    citationDocumentPreview: null,
  };
}

export function buildInactiveChatShellState(): ChatShellStatePatch {
  return {
    currentThreadId: null,
    citationDocumentPreview: null,
  };
}

export function useChatShellState(threadId: string) {
  const mutate = appStore((state) => state.mutate);

  useEffect(() => {
    mutate(buildActiveChatShellState(threadId));

    return () => {
      mutate(buildInactiveChatShellState());
    };
  }, [threadId, mutate]);
}
