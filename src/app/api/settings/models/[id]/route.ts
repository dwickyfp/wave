import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { LlmModelConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";

async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id } = await params;
    const json = await request.json();
    const data = LlmModelConfigZodSchema.partial().parse(json);
    const model = await settingsRepository.updateModel(id, data);
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }
    return NextResponse.json(model);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update model" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id } = await params;
    await settingsRepository.deleteModel(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete model" },
      { status: 500 },
    );
  }
}
