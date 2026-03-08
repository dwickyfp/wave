export function sanitizeExternalAgentModelName(agentName?: string | null) {
  const normalized = (agentName ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  return normalized || "agent";
}

export function getExternalAgentOpenAiModelId(agentName?: string | null) {
  return `codex-${sanitizeExternalAgentModelName(agentName)}`;
}

export function getExternalAgentAutocompleteOpenAiModelId(
  agentName?: string | null,
) {
  return `${getExternalAgentOpenAiModelId(agentName)}_autocomplete`;
}
