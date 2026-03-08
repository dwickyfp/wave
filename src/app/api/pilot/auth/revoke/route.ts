import { getSession } from "auth/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pilotExtensionRepository } from "lib/db/repository";
import { requirePilotExtensionSession } from "lib/pilot/auth";

const bodySchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    revokeAll: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.trim()) {
    try {
      const pilotSession = await requirePilotExtensionSession(request.headers);
      await pilotExtensionRepository.revokeSessionById(pilotSession.id);
      return NextResponse.json({ success: true });
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message || "Unauthorized" },
        { status: 401 },
      );
    }
  }

  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json().catch(() => undefined));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }
    throw error;
  }

  if (body?.revokeAll) {
    await pilotExtensionRepository.revokeSessionsByUserId(session.user.id);
    return NextResponse.json({ success: true });
  }

  if (body?.sessionId) {
    await pilotExtensionRepository.revokeSessionByUserAndId(
      session.user.id,
      body.sessionId,
    );
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { error: "Provide sessionId or revokeAll." },
    { status: 400 },
  );
}
