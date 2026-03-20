import {
  EvaluationJudgeModelConfigZodSchema,
  type EvaluationJudgeModelConfig,
} from "app-types/self-learning";
import {
  getEvaluationJudgeModelConfig,
  setEvaluationJudgeModelConfig,
} from "lib/self-learning/service";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../admin/evaluation/shared";

export async function GET() {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const config = await getEvaluationJudgeModelConfig();
    return NextResponse.json(config ?? null);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get evaluation judge model." },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const json = await request.json();

    if (json === null) {
      await setEvaluationJudgeModelConfig(null);
      return NextResponse.json({ success: true });
    }

    const config = EvaluationJudgeModelConfigZodSchema.parse(
      json,
    ) as EvaluationJudgeModelConfig;
    await setEvaluationJudgeModelConfig(config);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update evaluation judge model." },
      { status: 500 },
    );
  }
}
