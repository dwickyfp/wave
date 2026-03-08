import { describe, expect, it } from "vitest";
import {
  buildExternalChatTranscriptFromPreviews,
  buildExternalChatTranscriptFromSnapshot,
} from "./dashboard-session-transcript";

describe("dashboard session transcript", () => {
  it("builds a readable transcript from a full OpenAI message snapshot", () => {
    const transcript = buildExternalChatTranscriptFromSnapshot({
      requestMessages: [
        {
          role: "system",
          content: "hidden",
        },
        {
          role: "user",
          content: "Inspect main.py",
        },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"main.py"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call-1",
          content: '{"ok":true}',
        },
      ],
      responseMessage: {
        role: "assistant",
        content: "Review complete",
      },
    });

    expect(transcript).toHaveLength(4);
    expect(transcript[0]?.role).toBe("user");
    expect(transcript[1]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Tool calls:"),
    });
    expect(transcript[2]?.parts[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Tool result: call-1"),
    });
    expect(transcript[3]?.parts[0]).toMatchObject({
      type: "text",
      text: "Review complete",
    });
  });

  it("falls back to turn previews when no full transcript snapshot exists", () => {
    const transcript = buildExternalChatTranscriptFromPreviews([
      {
        id: "turn-1",
        requestPreview: "Review main.py",
        responsePreview: "Found 2 issues",
      },
    ]);

    expect(transcript).toEqual([
      {
        id: "turn-1-request-0",
        role: "user",
        parts: [{ type: "text", text: "Review main.py" }],
      },
      {
        id: "turn-1-response-0",
        role: "assistant",
        parts: [{ type: "text", text: "Found 2 issues" }],
      },
    ]);
  });
});
