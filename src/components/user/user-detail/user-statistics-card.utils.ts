export interface UserModelStat {
  model: string;
  messageCount: number;
  totalTokens: number;
  provider: string;
}

export function sortUserModelStats(modelStats: UserModelStat[]) {
  return [...modelStats].sort((left, right) => {
    if (right.totalTokens !== left.totalTokens) {
      return right.totalTokens - left.totalTokens;
    }

    if (right.messageCount !== left.messageCount) {
      return right.messageCount - left.messageCount;
    }

    return left.model.localeCompare(right.model);
  });
}

export function getTopModelPieData(modelStats: UserModelStat[]) {
  return sortUserModelStats(modelStats)
    .filter((modelStat) => modelStat.totalTokens > 0)
    .slice(0, 3)
    .map((modelStat) => ({
      label: modelStat.model,
      value: modelStat.totalTokens,
    }));
}
