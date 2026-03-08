import { NextResponse } from "next/server";
import { z } from "zod";
import { refreshPilotSession } from "lib/pilot/auth";

const bodySchema = z.object({
  refreshToken: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const refreshed = await refreshPilotSession(body.refreshToken);
    return NextResponse.json(refreshed);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: (error as Error).message || "Pilot session refresh failed." },
      { status: 401 },
    );
  }
}
