import { createSkillSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { skillRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const filtersParam = url.searchParams.get("filters") ?? "mine,shared";
  const filters = filtersParam
    .split(",")
    .filter((filter) => ["mine", "shared"].includes(filter)) as (
    | "mine"
    | "shared"
  )[];

  const skills = await skillRepository.selectSkills(session.user.id, filters);
  return NextResponse.json(skills);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = createSkillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const skill = await skillRepository.insertSkill({
    ...parsed.data,
    userId: session.user.id,
  });

  return NextResponse.json(skill, { status: 201 });
}
