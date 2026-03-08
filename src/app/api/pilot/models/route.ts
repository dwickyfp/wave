import { NextResponse } from "next/server";
import { getPilotModelProviders } from "lib/pilot/server";
import { resolvePilotAuthorizedUserId } from "lib/pilot/request-user";

export async function GET(request: Request) {
  try {
    await resolvePilotAuthorizedUserId(request.headers);
    return NextResponse.json(await getPilotModelProviders());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
