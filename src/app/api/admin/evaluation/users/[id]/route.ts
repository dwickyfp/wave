import {
  getSelfLearningUserDetail,
  setUserPersonalizationEnabled,
} from "lib/self-learning/service";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "../../shared";

const updateUserSchema = z.object({
  personalizationEnabled: z.boolean(),
});

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const detail = await getSelfLearningUserDetail(id);

    return NextResponse.json(detail);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load user evaluation detail." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const { id } = await context.params;
    const input = updateUserSchema.parse(await request.json());
    const config = await setUserPersonalizationEnabled({
      userId: id,
      enabled: input.personalizationEnabled,
      actorUserId: auth.session.user.id,
    });

    return NextResponse.json({ config });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update user personalization." },
      { status: 500 },
    );
  }
}
