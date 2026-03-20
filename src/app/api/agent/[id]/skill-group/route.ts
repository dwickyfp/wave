import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { agentRepository, skillGroupRepository } from "lib/db/repository";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await params;
  const groups = await skillGroupRepository.getGroupsByAgentId(agentId);
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await params;
  const { groupId } = await req.json();

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const hasAccess = await agentRepository.checkAccess(
    agentId,
    session.user.id,
    false,
  );
  if (!hasAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const group = await skillGroupRepository.selectGroupById(
    groupId,
    session.user.id,
  );
  if (!group) {
    return NextResponse.json(
      { error: "Skill group not found" },
      { status: 404 },
    );
  }

  await skillGroupRepository.linkAgentToGroup(agentId, groupId);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: agentId } = await params;
  const { groupId } = await req.json();

  if (!groupId) {
    return NextResponse.json({ error: "groupId required" }, { status: 400 });
  }

  const hasAccess = await agentRepository.checkAccess(
    agentId,
    session.user.id,
    false,
  );
  if (!hasAccess) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  await skillGroupRepository.unlinkAgentFromGroup(agentId, groupId);
  return NextResponse.json({ success: true });
}
