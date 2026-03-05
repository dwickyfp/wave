import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { knowledgeRepository } from "lib/db/repository";
import { queryKnowledge } from "lib/knowledge/retriever";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { query, topN } = await req.json();

  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const group = await knowledgeRepository.selectGroupById(id, session.user.id);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const results = await queryKnowledge(group, query, {
    topN: topN ?? 10,
    userId: session.user.id,
    source: "chat",
  });

  return NextResponse.json(results);
}
