import { NextResponse } from "next/server";
import { z } from "zod";
import {
  exchangePilotAuthCode,
  isValidChromiumExtensionId,
} from "lib/pilot/auth";

const bodySchema = z.object({
  code: z.string().min(1),
  extensionId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());

    if (!isValidChromiumExtensionId(body.extensionId)) {
      return NextResponse.json(
        { error: "Invalid browser extension id." },
        { status: 400 },
      );
    }

    const exchanged = await exchangePilotAuthCode(body);
    return NextResponse.json(exchanged);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: (error as Error).message || "Pilot auth exchange failed." },
      { status: 400 },
    );
  }
}
