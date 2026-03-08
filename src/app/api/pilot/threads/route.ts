import { NextResponse } from "next/server";
import { getPilotThreadsForUser } from "lib/pilot/server";
import { resolvePilotAuthorizedUserId } from "lib/pilot/request-user";

export async function GET(request: Request) {
  try {
    const userId = await resolvePilotAuthorizedUserId(request.headers);
    return NextResponse.json(await getPilotThreadsForUser(userId));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
