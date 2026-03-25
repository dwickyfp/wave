import { getCurrentUser } from "lib/auth/permissions";
import { userRepository } from "lib/db/repository";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  const users = await userRepository.listUsers(search);

  return NextResponse.json(users);
}
