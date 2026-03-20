import {
  getSelfLearningOverview,
  listSelfLearningUsers,
  setSelfLearningSystemConfig,
} from "lib/self-learning/service";
import { parseSelfLearningUsersSearchParams } from "lib/self-learning/admin";
import { ensureSelfLearningDailyScheduler } from "lib/self-learning/worker-client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminSession } from "./shared";

const updateSystemSchema = z.object({
  isRunning: z.boolean().optional(),
  biasGuardMinimumEvals: z.number().int().min(1).max(100).optional(),
  minDistinctThreads: z.number().int().min(1).max(50).optional(),
  maxActiveMemories: z.number().int().min(1).max(20).optional(),
  dailySchedulerPattern: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const searchState = parseSelfLearningUsersSearchParams(
      request.nextUrl.searchParams,
    );

    const [overview, usersPage] = await Promise.all([
      getSelfLearningOverview(),
      listSelfLearningUsers(searchState),
    ]);

    return NextResponse.json({ overview, usersPage });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load evaluation system." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const input = updateSystemSchema.parse(await request.json());
    const system = await setSelfLearningSystemConfig(input);
    await ensureSelfLearningDailyScheduler(system.dailySchedulerPattern);

    return NextResponse.json({ system });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update evaluation system." },
      { status: 500 },
    );
  }
}
