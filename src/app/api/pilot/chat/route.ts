import { NextResponse } from "next/server";
import { pilotChatRequestSchema } from "app-types/pilot";
import { requirePilotExtensionSession } from "lib/pilot/auth";
import { runPilotChat, streamPilotChat } from "lib/pilot/chat";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    const pilotSession = await requirePilotExtensionSession(request.headers);
    const body = pilotChatRequestSchema.parse(await request.json());

    if (body.stream) {
      return await streamPilotChat({
        userId: pilotSession.userId,
        request: body,
        abortSignal: request.signal,
      });
    }

    const result = await runPilotChat({
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

    const message = (error as Error).message || "Pilot chat failed.";
    const status =
      message.includes("token") || message.includes("Unauthorized") ? 401 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
