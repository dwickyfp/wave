export const CHAT_KNOWLEDGE_CONTEXT_TOKENS = 5000;

export function estimateKnowledgePromptTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function allocateSequentialKnowledgeTokens(
  remainingBudget: number,
  groupsLeft: number,
  minimumPerGroup = 500,
) {
  if (remainingBudget <= 0 || groupsLeft <= 0) return 0;

  const evenShare = Math.floor(remainingBudget / groupsLeft);
  return Math.min(
    remainingBudget,
    Math.max(Math.min(remainingBudget, minimumPerGroup), evenShare),
  );
}
