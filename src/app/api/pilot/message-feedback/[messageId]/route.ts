import { NextResponse } from "next/server";
import { chatRepository } from "lib/db/repository";
import { resolvePilotAuthorizedUserId } from "lib/pilot/request-user";
import { z } from "zod";

const pilotFeedbackRequestSchema = z.object({
  type: z.enum(["like", "dislike"]),
  reason: z.string().trim().max(2000).optional(),
});

async function resolvePilotFeedbackUserAndAccess(
  request: Request,
  messageId: string,
) {
  const userId = await resolvePilotAuthorizedUserId(request.headers);
  const threadId = await chatRepository.selectThreadIdByMessageId(messageId);

  if (!threadId) {
    return {
      userId,
      threadId: null,
    };
  }

  const hasAccess = await chatRepository.checkAccess(threadId, userId);
  if (!hasAccess) {
    throw new Error("Unauthorized");
  }

  return {
    userId,
    threadId,
  };
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{
      messageId: string;
    }>;
  },
) {
  try {
    const { messageId } = await context.params;
    const access = await resolvePilotFeedbackUserAndAccess(request, messageId);

    if (!access.threadId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const feedback = await chatRepository.getMessageFeedback(
      messageId,
      access.userId,
    );

    return NextResponse.json({
      type: feedback?.type ?? null,
      reason: feedback?.reason ?? null,
    });
  } catch (error) {
    const message = (error as Error).message || "Unauthorized";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      messageId: string;
    }>;
  },
) {
  try {
    const { messageId } = await context.params;
    const body = pilotFeedbackRequestSchema.parse(await request.json());
    const access = await resolvePilotFeedbackUserAndAccess(request, messageId);

    if (!access.threadId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const feedback = await chatRepository.upsertMessageFeedback(
      messageId,
      access.userId,
      body.type,
      body.reason,
    );

    return NextResponse.json({
      type: feedback.type,
      reason: feedback.reason ?? null,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || "Invalid request." },
        { status: 400 },
      );
    }

    const message = (error as Error).message || "Unauthorized";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{
      messageId: string;
    }>;
  },
) {
  try {
    const { messageId } = await context.params;
    const access = await resolvePilotFeedbackUserAndAccess(request, messageId);

    if (!access.threadId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await chatRepository.deleteMessageFeedback(messageId, access.userId);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = (error as Error).message || "Unauthorized";
    const status = message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
