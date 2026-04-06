import { type Tool, type ToolExecutionOptions } from "ai";
import { errorToString } from "lib/utils";

export async function executeBoundToolCall(input: {
  toolName: string;
  tool: Tool | undefined;
  args: unknown;
  toolCallId: string;
  abortSignal?: AbortSignal;
}) {
  const { toolName, tool, args, toolCallId, abortSignal } = input;

  try {
    if (!tool?.execute) {
      throw new Error(`tool not found: ${toolName}`);
    }

    return await tool.execute(args, {
      toolCallId,
      abortSignal: abortSignal ?? new AbortController().signal,
      messages: [],
    } as ToolExecutionOptions);
  } catch (error) {
    return {
      isError: true,
      statusMessage: `tool call fail: ${toolName}`,
      error: errorToString(error),
    };
  }
}
