import { NextResponse } from "next/server";
import { pilotChatContinueRequestSchema } from "app-types/pilot";
import { z } from "zod";
import { requirePilotExtensionSession } from "lib/pilot/auth";
import { continuePilotChat } from "lib/pilot/chat";

export async function POST(request: Request) {
  try {
    const pilotSession = await requirePilotExtensionSession(request.headers);
    const body = pilotChatContinueRequestSchema.parse(await request.json());

    const result = await continuePilotChat({
      userId: pilotSession.userId,
      request: body,
      abortSignal: request.signal,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }

    const message = (error as Error).message || "Pilot continuation failed.";
    const status =
      message.includes("token") || message.includes("Unauthorized") ? 401 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
