import { getSession } from "auth/server";
import { settingsRepository } from "lib/db/repository";
import { resetFileStorage } from "lib/file-storage";
import { FileStorageConfigZodSchema } from "app-types/settings";
import { NextResponse } from "next/server";

const STORAGE_KEY = "file-storage-config";
// Sentinel value used when a secret field is not changed by the client
const MASKED_VALUE = "********";

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

/** Mask secrets before returning to the client. */
function maskConfig(raw: Record<string, any>) {
  const masked = { ...raw };
  if (masked.s3) {
    masked.s3 = { ...masked.s3 };
    if (masked.s3.secretKey) masked.s3.secretKey = MASKED_VALUE;
  }
  if (masked.vercelBlob) {
    masked.vercelBlob = { ...masked.vercelBlob };
    if (masked.vercelBlob.token) masked.vercelBlob.token = MASKED_VALUE;
  }
  return masked;
}

export async function GET() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const config = (await settingsRepository.getSetting(STORAGE_KEY)) as Record<
      string,
      any
    > | null;
    if (!config) {
      return NextResponse.json(null);
    }
    return NextResponse.json(maskConfig(config));
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to get storage config" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const json = await request.json();
    const incoming = FileStorageConfigZodSchema.parse(json);

    // Preserve existing secrets if the client sent the masked sentinel value
    const existing = (await settingsRepository.getSetting(
      STORAGE_KEY,
    )) as Record<string, any> | null;

    if (incoming.s3 && incoming.s3.secretKey === MASKED_VALUE) {
      incoming.s3.secretKey = existing?.s3?.secretKey ?? "";
    }
    if (incoming.vercelBlob && incoming.vercelBlob.token === MASKED_VALUE) {
      incoming.vercelBlob.token = existing?.vercelBlob?.token ?? "";
    }

    await settingsRepository.upsertSetting(STORAGE_KEY, incoming);

    // Invalidate the cached storage instance so the next call uses the new config
    resetFileStorage();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to save storage config" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    await settingsRepository.upsertSetting(STORAGE_KEY, null);
    resetFileStorage();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to clear storage config" },
      { status: 500 },
    );
  }
}
