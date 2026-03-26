import { describe, expect, it } from "vitest";
import { buildRenderGroups } from "./message-render-groups";

const knowledgeImages = [
  {
    groupId: "group-1",
    groupName: "Docs",
    documentId: "doc-1",
    documentName: "Guide",
    imageId: "image-1",
    versionId: "version-1",
    label: "Sign-in screen",
    description: "Screenshot of the sign-in form.",
    headingPath: "Guide > Authentication",
    stepHint: "Open the sign-in screen.",
    pageNumber: 2,
    assetUrl: "/api/knowledge/group-1/documents/doc-1/images/image-1/asset",
  },
];

describe("buildRenderGroups", () => {
  it("inserts related images before the final assistant answer text", () => {
    const groups = buildRenderGroups(
      [
        {
          type: "tool-get_docs_group_1",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "sign in" },
          output: { images: knowledgeImages },
        },
        { type: "text", text: "Final answer", state: "done" },
      ] as any,
      knowledgeImages,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "single",
      "knowledge-images",
      "single",
    ]);
    expect(groups[1]).toMatchObject({
      type: "knowledge-images",
      images: knowledgeImages,
    });
  });

  it("appends related images when the assistant answer text is absent", () => {
    const groups = buildRenderGroups(
      [
        {
          type: "tool-get_docs_group_1",
          toolCallId: "call-1",
          state: "output-available",
          input: { query: "sign in" },
          output: { images: knowledgeImages },
        },
      ] as any,
      knowledgeImages,
    );

    expect(groups.map((group) => group.type)).toEqual([
      "single",
      "knowledge-images",
    ]);
  });
});
