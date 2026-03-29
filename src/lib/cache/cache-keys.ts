export const CacheKeys = {
  thread: (threadId: string) => `thread-${threadId}`,
  user: (userId: string) => `user-${userId}`,
  mcpServerCustomizations: (userId: string) =>
    `mcp-server-customizations-${userId}`,
  agentInstructions: (agent: string) => `agent-instructions-${agent}`,
  providerConfig: (provider: string) => `provider-config-${provider}`,
  providerModelConfig: (provider: string, model: string) =>
    `provider-model-config-${provider}-${model}`,
  rerankingModelConfig: (provider: string, model: string) =>
    `reranking-model-config-${provider}-${model}`,
  embedding: (provider: string, model: string, hash: string) =>
    `embedding-${provider}-${model}-${hash}`,
  knowledgeDocs: (
    groupId: string,
    mode: string,
    hash: string,
    tokens: number,
    maxDocs: number,
  ) => `knowledge-docs-${groupId}-${mode}-${tokens}-${maxDocs}-${hash}`,
  knowledgeDocumentSummary: (
    groupId: string,
    documentId: string,
    versionId: string,
    hash: string,
  ) =>
    `knowledge-document-summary-${groupId}-${documentId}-${versionId}-${hash}`,
  knowledgeQueryRewrite: (hash: string) => `knowledge-query-rewrite-${hash}`,
};
