import { describe, expect, it } from "vitest";

import {
  buildChatKnowledgeSources,
  dedupeChatKnowledgeSources,
} from "./knowledge-sources";

describe("buildChatKnowledgeSources", () => {
  it("maps retrieved docs into compact chat metadata sources", () => {
    expect(
      buildChatKnowledgeSources({
        groupId: "group-1",
        groupName: "Policies",
        docs: [
          {
            documentId: "doc-1",
            documentName: "Refund Policy",
            sourceGroupId: "source-1",
            sourceGroupName: "Global Policies",
            isInherited: true,
            matchedSections: [
              { heading: "Refund window" },
              { heading: "Refund window" },
              { heading: "Exceptions" },
              { heading: "Regional rules" },
            ],
          },
        ],
      }),
    ).toEqual([
      {
        groupId: "group-1",
        groupName: "Policies",
        documentId: "doc-1",
        documentName: "Refund Policy",
        sourceGroupId: "source-1",
        sourceGroupName: "Global Policies",
        isInherited: true,
        matchedSections: ["Refund window", "Exceptions", "Regional rules"],
      },
    ]);
  });
});

describe("dedupeChatKnowledgeSources", () => {
  it("merges duplicate document entries and keeps unique section headings", () => {
    expect(
      dedupeChatKnowledgeSources([
        {
          groupId: "group-1",
          groupName: "Policies",
          documentId: "doc-1",
          documentName: "Refund Policy",
          matchedSections: ["Refund window", "Exceptions"],
        },
        {
          groupId: "group-1",
          groupName: "Policies",
          documentId: "doc-1",
          documentName: "Refund Policy",
          matchedSections: ["Exceptions", "Regional rules"],
        },
      ]),
    ).toEqual([
      {
        groupId: "group-1",
        groupName: "Policies",
        documentId: "doc-1",
        documentName: "Refund Policy",
        matchedSections: ["Refund window", "Exceptions", "Regional rules"],
      },
    ]);
  });
});
