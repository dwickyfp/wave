import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { LlmProviderUpsertZodSchema } from "app-types/settings";
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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id } = await params;
    const provider = await settingsRepository.getProviderById(id);
    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(provider);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get provider" },
      { status: 500 },
    );
  }
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
    const data = LlmProviderUpsertZodSchema.partial().parse(json);
    const provider = await settingsRepository.updateProvider(id, data);
    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 },
      );
    }
    return NextResponse.json(provider);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to update provider" },
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
    await settingsRepository.deleteProvider(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to delete provider" },
      { status: 500 },
    );
  }
}
