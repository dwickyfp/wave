import { NextResponse } from "next/server";
import { getPilotThreadForUser } from "lib/pilot/server";
import { resolvePilotAuthorizedUserId } from "lib/pilot/request-user";

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const userId = await resolvePilotAuthorizedUserId(request.headers);
    const { id } = await context.params;
    const thread = await getPilotThreadForUser(userId, id);

    if (!thread) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(thread);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
