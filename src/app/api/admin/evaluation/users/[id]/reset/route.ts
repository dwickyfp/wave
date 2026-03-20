import { resetUserPersonalization } from "lib/self-learning/service";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../../shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const { id } = await context.params;
    await resetUserPersonalization({
      userId: id,
      actorUserId: auth.session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to reset personalization." },
      { status: 500 },
    );
  }
}
