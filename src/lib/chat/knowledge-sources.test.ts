import { describe, expect, it } from "vitest";

import {
  buildChatKnowledgeSources,
  dedupeChatKnowledgeSources,
  getMessageKnowledgeImages,
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

describe("getMessageKnowledgeImages", () => {
  it("falls back to persisted knowledge tool output images when metadata is missing", () => {
    expect(
      getMessageKnowledgeImages({
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-get_docs_group_1",
            toolCallId: "call-1",
            state: "output-available",
            input: { query: "sign in" },
            output: {
              images: [
                {
                  groupId: "group-1",
                  groupName: "Policies",
                  documentId: "doc-1",
                  documentName: "Refund Policy",
                  imageId: "image-1",
                  versionId: "version-1",
                  label: "Sign-in screen",
                  description: "Screenshot of the sign-in form.",
                  headingPath: "Guide > Authentication",
                  stepHint: "Open the sign-in screen.",
                  pageNumber: 2,
                  assetUrl: "/api/knowledge/group-1/doc-1/images/image-1",
                },
              ],
            },
          },
          { type: "text", text: "Answer", state: "done" },
        ],
      } as any),
    ).toEqual([
      {
        groupId: "group-1",
        groupName: "Policies",
        documentId: "doc-1",
        documentName: "Refund Policy",
        imageId: "image-1",
        versionId: "version-1",
        label: "Sign-in screen",
        description: "Screenshot of the sign-in form.",
        headingPath: "Guide > Authentication",
        stepHint: "Open the sign-in screen.",
        pageNumber: 2,
        assetUrl: "/api/knowledge/group-1/doc-1/images/image-1",
      },
    ]);
  });
});
