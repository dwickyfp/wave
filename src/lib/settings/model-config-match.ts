type ModelConfigMatchCandidate = {
  apiName: string;
  uiName: string;
};

export function pickPreferredModelConfig<T extends ModelConfigMatchCandidate>(
  modelName: string,
  modelRows: T[],
): T | null {
  return (
    modelRows.find((row) => row.uiName === modelName) ??
    modelRows.find((row) => row.apiName === modelName) ??
    null
  );
}
