export type UserMessageMentionKind = "tool" | "agent" | "mcp" | "knowledge";

export type UserMessageSegment =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "mention";
      mentionKind: UserMessageMentionKind;
      value: string;
      raw: string;
    };

const USER_MESSAGE_MENTION_REGEX =
  /@(tool|agent|mcp|knowledge)\(\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)')\s*\)/g;

export function tokenizeUserMessageMentions(
  text: string,
): UserMessageSegment[] {
  const segments: UserMessageSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = USER_MESSAGE_MENTION_REGEX.exec(text)) !== null) {
    const start = match.index;
    const end = USER_MESSAGE_MENTION_REGEX.lastIndex;
    const mentionKind = match[1] as UserMessageMentionKind;
    const value = match[2] ?? match[3] ?? "";

    if (start > lastIndex) {
      segments.push({
        type: "text",
        text: text.slice(lastIndex, start),
      });
    }

    segments.push({
      type: "mention",
      mentionKind,
      value,
      raw: match[0],
    });

    lastIndex = end;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: "text",
      text: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", text }];
}
