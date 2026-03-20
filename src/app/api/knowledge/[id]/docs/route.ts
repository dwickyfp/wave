import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { queryKnowledgeAsDocs } from "lib/knowledge/retriever";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { query, tokens, issuer, ticker, page, note, strictEntityMatch } =
    await req.json();

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const results = await queryKnowledgeAsDocs(group, query, {
    tokens: tokens ?? 10000,
    issuer,
    ticker,
    page,
    note,
    strictEntityMatch,
    resultMode: "matched-sections",
    maxDocs: 8,
    userId: session.user.id,
    source: "chat",
  });

  return NextResponse.json(results);
}
