import type { KnowledgeDocumentProcessingState } from "app-types/knowledge";

export function formatKnowledgeDocumentProcessingState(
  state?: KnowledgeDocumentProcessingState | null,
): string | null {
  if (!state) return null;

  if (
    state.stage === "parsing" &&
    state.currentPage != null &&
    state.totalPages != null
  ) {
    return `Parsing page ${state.currentPage}/${state.totalPages}`;
  }

  switch (state.stage) {
    case "extracting":
      return "Extracting document";
    case "materializing":
      return "Structuring chunks";
    case "embedding":
      return "Embedding chunks";
    case "finalizing":
      return "Finalizing document";
    default:
      return "Processing document";
  }
}
