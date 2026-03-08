import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { getPilotConfigForUser } from "lib/pilot/server";
import { resolvePilotAuthorizedUserId } from "lib/pilot/request-user";

export async function GET(request: Request) {
  const webSession = await getSession();

  if (webSession?.user?.id) {
    return NextResponse.json(await getPilotConfigForUser(webSession.user.id));
  }

  try {
    const userId = await resolvePilotAuthorizedUserId(request.headers);
    return NextResponse.json(await getPilotConfigForUser(userId));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
