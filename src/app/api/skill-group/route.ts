import { createSkillGroupSchema } from "app-types/skill";
import { getSession } from "auth/server";
import { skillGroupRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const filtersParam = url.searchParams.get("filters") ?? "mine,shared";
  const filters = filtersParam
    .split(",")
    .filter((filter) => ["mine", "shared"].includes(filter)) as (
    | "mine"
    | "shared"
  )[];

  const groups = await skillGroupRepository.selectGroups(
    session.user.id,
    filters,
  );
  return NextResponse.json(groups);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createSkillGroupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const group = await skillGroupRepository.insertGroup({
    ...parsed.data,
    userId: session.user.id,
  });

  return NextResponse.json(group, { status: 201 });
}
