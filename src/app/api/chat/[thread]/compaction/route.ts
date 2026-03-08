import { getSession } from "auth/server";
import { chatRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

interface Params {
  params: Promise<{ thread: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { thread: threadId } = await params;
  const thread = await chatRepository.selectThread(threadId);
  if (!thread || thread.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [compactionCheckpoint, compactionState] = await Promise.all([
    chatRepository.selectCompactionCheckpoint(threadId),
    chatRepository.selectCompactionState(threadId),
  ]);

  return NextResponse.json({
    compactionCheckpoint,
    compactionState,
  });
}
