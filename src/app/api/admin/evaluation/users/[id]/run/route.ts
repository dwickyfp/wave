import { selfLearningRepository } from "lib/db/repository";
import { getSelfLearningUserEligibility } from "lib/self-learning/service";
import { enqueueEvaluateUser } from "lib/self-learning/worker-client";
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
    const userRow = await selfLearningRepository.getUserRow(id);
    if (!userRow) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const eligibility = await getSelfLearningUserEligibility(id, userRow);

    if (eligibility.eligibleCandidateCount === 0) {
      return NextResponse.json(
        {
          error: "No eligible training data is available for this user yet.",
          code: "no_eligible_training_data",
          user: {
            id: userRow.userId,
            name: userRow.name,
            email: userRow.email,
          },
          eligibility,
        },
        { status: 422 },
      );
    }

    const run = await selfLearningRepository.createRun({
      userId: id,
      trigger: "manual",
      status: "queued",
      metadata: {
        bypassPause: true,
        queuedBy: auth.session.user.id,
      },
    });

    await selfLearningRepository.insertAuditLog({
      userId: id,
      actorUserId: auth.session.user.id,
      runId: run.id,
      action: "manual_run_requested",
      details: {
        bypassPause: true,
        eligibility,
      },
    });

    try {
      await enqueueEvaluateUser({
        userId: id,
        runId: run.id,
        trigger: "manual",
        actorUserId: auth.session.user.id,
        bypassPause: true,
      });
    } catch (error: any) {
      await selfLearningRepository.updateRun(run.id, {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error?.message ?? "Failed to enqueue self-learning run",
      });
      throw error;
    }

    return NextResponse.json({
      success: true,
      queued: true,
      runId: run.id,
      user: {
        id: userRow.userId,
        name: userRow.name,
        email: userRow.email,
        threadCount: userRow.threadCount,
        signalCount: userRow.signalCount,
      },
      eligibility,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to queue manual evaluation run." },
      { status: 500 },
    );
  }
}
