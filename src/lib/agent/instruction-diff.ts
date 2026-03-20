export type InstructionDiffLine = {
  type: "unchanged" | "added" | "removed";
  text: string;
  key: string;
  leftLineNumber?: number;
  rightLineNumber?: number;
};

export type InstructionDiffResult = {
  lines: InstructionDiffLine[];
  hasChanges: boolean;
  addedCount: number;
  removedCount: number;
};

function splitLines(value: string) {
  if (!value) {
    return [] as string[];
  }

  return value.split("\n");
}

export function buildInstructionDiff(
  before: string,
  after: string,
): InstructionDiffResult {
  const left = splitLines(before);
  const right = splitLines(after);

  const lcs = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        lcs[leftIndex][rightIndex] = lcs[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        lcs[leftIndex][rightIndex] = Math.max(
          lcs[leftIndex + 1][rightIndex],
          lcs[leftIndex][rightIndex + 1],
        );
      }
    }
  }

  const lines: InstructionDiffLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      lines.push({
        type: "unchanged",
        text: left[leftIndex],
        key: `same-${leftIndex}-${rightIndex}`,
        leftLineNumber: leftIndex + 1,
        rightLineNumber: rightIndex + 1,
      });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (lcs[leftIndex + 1][rightIndex] >= lcs[leftIndex][rightIndex + 1]) {
      lines.push({
        type: "removed",
        text: left[leftIndex],
        key: `removed-${leftIndex}`,
        leftLineNumber: leftIndex + 1,
      });
      leftIndex += 1;
      continue;
    }

    lines.push({
      type: "added",
      text: right[rightIndex],
      key: `added-${rightIndex}`,
      rightLineNumber: rightIndex + 1,
    });
    rightIndex += 1;
  }

  while (leftIndex < left.length) {
    lines.push({
      type: "removed",
      text: left[leftIndex],
      key: `removed-tail-${leftIndex}`,
      leftLineNumber: leftIndex + 1,
    });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    lines.push({
      type: "added",
      text: right[rightIndex],
      key: `added-tail-${rightIndex}`,
      rightLineNumber: rightIndex + 1,
    });
    rightIndex += 1;
  }

  const addedCount = lines.filter((line) => line.type === "added").length;
  const removedCount = lines.filter((line) => line.type === "removed").length;

  return {
    lines,
    hasChanges: addedCount > 0 || removedCount > 0,
    addedCount,
    removedCount,
  };
}
