import { NextRequest, NextResponse } from "next/server";
import { getSession } from "auth/server";
import { agentRepository, skillRepository } from "lib/db/repository";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const skills = await skillRepository.getSkillsByAgentId(agentId);
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const { skillId } = await req.json();

  if (!skillId)
    return NextResponse.json({ error: "skillId required" }, { status: 400 });

  const hasAccess = await agentRepository.checkAccess(
    agentId,
    session.user.id,
    false,
  );
  if (!hasAccess)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const skill = await skillRepository.selectSkillById(skillId, session.user.id);
  if (!skill)
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });

  await skillRepository.linkAgentToSkill(agentId, skillId);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: agentId } = await params;
  const { skillId } = await req.json();

  if (!skillId)
    return NextResponse.json({ error: "skillId required" }, { status: 400 });

  const hasAccess = await agentRepository.checkAccess(
    agentId,
    session.user.id,
    false,
  );
  if (!hasAccess)
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  await skillRepository.unlinkAgentFromSkill(agentId, skillId);
  return NextResponse.json({ success: true });
}
