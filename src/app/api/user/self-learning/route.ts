import { getSession } from "auth/server";
import {
  deleteUserLearningData,
  getUserLearningDeletionStatus,
} from "lib/self-learning/service";
import { NextResponse } from "next/server";

async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { session };
}

export async function GET() {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const status = await getUserLearningDeletionStatus(auth.session.user.id);
    return NextResponse.json(status);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load learning data status." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    await deleteUserLearningData({
      userId: auth.session.user.id,
      actorUserId: auth.session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete learning data." },
      { status: 500 },
    );
  }
}
