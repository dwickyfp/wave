import {
  SelfLearningEmbeddingModelConfigZodSchema,
  type SelfLearningEmbeddingModelConfig,
} from "app-types/self-learning";
import {
  getSelfLearningEmbeddingModelConfig,
  setSelfLearningEmbeddingModelConfig,
} from "lib/self-learning/service";
import { NextResponse } from "next/server";
import { requireAdminSession } from "../../admin/evaluation/shared";

export async function GET() {
  try {
    const auth = await requireAdminSession();
    if (auth.error) return auth.error;

    const config = await getSelfLearningEmbeddingModelConfig();
    return NextResponse.json(config ?? null);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || "Failed to get self-learning embedding model.",
      },
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
      await setSelfLearningEmbeddingModelConfig(null);
      return NextResponse.json({ success: true });
    }

    const config = SelfLearningEmbeddingModelConfigZodSchema.parse(
      json,
    ) as SelfLearningEmbeddingModelConfig;
    await setSelfLearningEmbeddingModelConfig(config);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      {
        error:
          error.message || "Failed to update self-learning embedding model.",
      },
      { status: 500 },
    );
  }
}
