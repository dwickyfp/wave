import "load-env";

import { readFileSync } from "node:fs";
import { z } from "zod";
import { knowledgeRepository } from "lib/db/repository";
import { queryKnowledgeAsDocs } from "lib/knowledge/retriever";

const FixtureSchema = z.object({
  query: z.string().min(1),
  expectedDocumentIds: z.array(z.string()).default([]),
  expectedDocumentNames: z.array(z.string()).default([]),
  expectedSectionHeadings: z.array(z.string()).default([]),
  expectedPages: z.array(z.number().int()).default([]),
});

const FixtureFileSchema = z.object({
  groupId: z.string().uuid().optional(),
  userId: z.string().optional().nullable(),
  source: z.enum(["chat", "agent", "mcp"]).default("chat"),
  fixtures: z.array(FixtureSchema).min(1),
});

function parseArg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function computeReciprocalRank(results: string[], expected: Set<string>) {
  for (let index = 0; index < results.length; index += 1) {
    if (expected.has(results[index])) {
      return 1 / (index + 1);
    }
  }
  return 0;
}

const fixturePath =
  parseArg("fixtures") ?? "tests/fixtures/contextx-eval.sample.json";
const file = FixtureFileSchema.parse(
  JSON.parse(readFileSync(fixturePath, "utf-8")),
);
const groupId = parseArg("group") ?? file.groupId;
if (!groupId) {
  throw new Error(
    "Pass --group <knowledge-group-id> or include groupId in the fixture file.",
  );
}

const group = await knowledgeRepository.selectGroupByIdForMcp(groupId);
if (!group) {
  throw new Error(`Knowledge group not found: ${groupId}`);
}

const rows: Array<{
  query: string;
  recallAt5: number;
  reciprocalRank: number;
  exactCitationHit: number;
}> = [];

for (const fixture of file.fixtures) {
  const docs = await queryKnowledgeAsDocs(group, fixture.query, {
    userId: file.userId ?? null,
    source: file.source,
    tokens: 8000,
    maxDocs: 5,
    resultMode: "section-first",
  });

  const rankedIds = docs.map((doc) => doc.documentId);
  const rankedNames = docs.map((doc) => doc.documentName.toLowerCase());
  const expectedDocKeys = new Set([
    ...fixture.expectedDocumentIds,
    ...fixture.expectedDocumentNames.map((name) => name.toLowerCase()),
  ]);
  const hit = rankedIds.some((id) => expectedDocKeys.has(id))
    ? 1
    : rankedNames.some((name) => expectedDocKeys.has(name))
      ? 1
      : 0;
  const expectedPageSet = new Set(fixture.expectedPages);
  const exactCitationHit =
    expectedPageSet.size === 0
      ? 1
      : docs.some((doc) =>
            (doc.citationCandidates ?? []).some((citation) =>
              expectedPageSet.has(citation.pageStart ?? -1),
            ),
          )
        ? 1
        : 0;

  rows.push({
    query: fixture.query,
    recallAt5: hit,
    reciprocalRank: computeReciprocalRank(
      [...rankedIds, ...rankedNames],
      expectedDocKeys,
    ),
    exactCitationHit,
  });
}

const average = (values: number[]) =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

console.info(
  JSON.stringify(
    {
      groupId,
      fixturePath,
      fixtureCount: rows.length,
      recallAt5: average(rows.map((row) => row.recallAt5)),
      mrr: average(rows.map((row) => row.reciprocalRank)),
      citationPageAccuracy: average(rows.map((row) => row.exactCitationHit)),
      rows,
    },
    null,
    2,
  ),
);
