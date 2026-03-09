import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("lib/db/repository", () => ({
  selfLearningRepository: {
    getUserRow: vi.fn(),
    createRun: vi.fn(),
    insertAuditLog: vi.fn(),
    updateRun: vi.fn(),
  },
}));

vi.mock("lib/self-learning/service", () => ({
  getSelfLearningUserEligibility: vi.fn(),
}));

vi.mock("lib/self-learning/worker-client", () => ({
  enqueueEvaluateUser: vi.fn(),
}));

vi.mock("../../../shared", () => ({
  requireAdminSession: vi.fn(),
}));

const { POST } = await import("./route");
const { selfLearningRepository } = await import("lib/db/repository");
const { getSelfLearningUserEligibility } = await import(
  "lib/self-learning/service"
);
const { enqueueEvaluateUser } = await import("lib/self-learning/worker-client");
const { requireAdminSession } = await import("../../../shared");

function withParams(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as {
    params: Promise<{
      id: string;
    }>;
  };
}

describe("admin self-learning manual run route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminSession).mockResolvedValue({
      session: {
        user: {
          id: "admin-1",
        },
      },
    } as any);
  });

  it("returns 422 and does not enqueue when no eligible training data exists", async () => {
    vi.mocked(selfLearningRepository.getUserRow).mockResolvedValue({
      userId: "user-1",
      name: "Admin Pol",
      email: "admin@admin.com",
      personalizationEnabled: true,
      threadCount: 0,
      assistantTurnCount: 0,
      evaluatedAssistantTurnCount: 0,
      signalCount: 0,
      eligibleCandidateCount: 0,
      emptyReason: "no_chat_history",
      evaluationCount: 0,
      activeMemoryCount: 0,
      lastRunAt: null,
      lastEvaluatedAt: null,
    } as any);
    vi.mocked(getSelfLearningUserEligibility).mockResolvedValue({
      threadCount: 0,
      signalCount: 0,
      assistantTurnCount: 0,
      evaluatedAssistantTurnCount: 0,
      eligibleCandidateCount: 0,
      emptyReason: "no_chat_history",
    });

    const response = await POST(
      new Request("http://localhost/api/admin/evaluation/users/user-1/run", {
        method: "POST",
      }),
      withParams("user-1"),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "no_eligible_training_data",
      eligibility: {
        eligibleCandidateCount: 0,
        emptyReason: "no_chat_history",
      },
    });
    expect(selfLearningRepository.createRun).not.toHaveBeenCalled();
    expect(enqueueEvaluateUser).not.toHaveBeenCalled();
  });

  it("queues a BullMQ job when eligible training data exists", async () => {
    vi.mocked(selfLearningRepository.getUserRow).mockResolvedValue({
      userId: "user-2",
      name: "Dwicky Feri",
      email: "feri.dfp@gmail.com",
      personalizationEnabled: true,
      threadCount: 52,
      assistantTurnCount: 18,
      evaluatedAssistantTurnCount: 0,
      signalCount: 0,
      eligibleCandidateCount: 15,
      emptyReason: null,
      evaluationCount: 0,
      activeMemoryCount: 0,
      lastRunAt: null,
      lastEvaluatedAt: null,
    } as any);
    vi.mocked(getSelfLearningUserEligibility).mockResolvedValue({
      threadCount: 52,
      signalCount: 0,
      assistantTurnCount: 18,
      evaluatedAssistantTurnCount: 0,
      eligibleCandidateCount: 15,
      emptyReason: null,
    });
    vi.mocked(selfLearningRepository.createRun).mockResolvedValue({
      id: "run-1",
    } as any);
    vi.mocked(selfLearningRepository.insertAuditLog).mockResolvedValue(
      {} as any,
    );

    const response = await POST(
      new Request("http://localhost/api/admin/evaluation/users/user-2/run", {
        method: "POST",
      }),
      withParams("user-2"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      runId: "run-1",
      eligibility: {
        eligibleCandidateCount: 15,
      },
    });
    expect(selfLearningRepository.createRun).toHaveBeenCalled();
    expect(selfLearningRepository.insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "manual_run_requested",
        details: expect.objectContaining({
          eligibility: expect.objectContaining({
            eligibleCandidateCount: 15,
          }),
        }),
      }),
    );
    expect(enqueueEvaluateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-2",
        runId: "run-1",
        trigger: "manual",
      }),
    );
  });
});
