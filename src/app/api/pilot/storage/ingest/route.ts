import { NextResponse } from "next/server";
import { parseCsvPreview, formatCsvPreviewText } from "lib/file-ingest/csv";
import { serverFileStorage } from "lib/file-storage";
import { storageKeyFromUrl } from "lib/file-storage/storage-utils";
import { isUserOwnedStorageKey } from "lib/file-storage/upload-policy";
import { requirePilotExtensionSession } from "lib/pilot/auth";

type Body = {
  key?: string;
  url?: string;
  type?: "csv" | "auto";
  maxRows?: number;
  maxCols?: number;
};

export async function POST(request: Request) {
  try {
    const pilotSession = await requirePilotExtensionSession(request.headers);
    const body = (await request.json()) as Body;

    const key =
      body.key || (body.url ? storageKeyFromUrl(body.url) : undefined);
    if (!key) {
      return NextResponse.json(
        { error: "Missing 'key' or 'url'" },
        { status: 400 },
      );
    }

    if (!isUserOwnedStorageKey(key, pilotSession.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const type = body.type || "auto";
    const isCsv =
      type === "csv" ||
      /\.(csv)$/i.test(key) ||
      /(^|[?&])contentType=text\/csv(&|$)/i.test(body.url || "");

    if (!isCsv) {
      return NextResponse.json(
        {
          error: "Unsupported file type for ingest",
          solution:
            "Currently supported: CSV. Convert your spreadsheet to CSV or paste sample rows.",
        },
        { status: 400 },
      );
    }

    const buf = await serverFileStorage.download(key);
    const preview = parseCsvPreview(buf, {
      maxRows: Math.min(200, Math.max(1, body.maxRows ?? 50)),
      maxCols: Math.min(40, Math.max(1, body.maxCols ?? 12)),
    });

    const text = formatCsvPreviewText(key, preview);

    return NextResponse.json({ ok: true, type: "csv", key, preview, text });
  } catch (error) {
    const message = (error as Error).message || "Unauthorized";
    const status =
      message.includes("token") || message.includes("Unauthorized") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
