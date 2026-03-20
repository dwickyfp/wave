import { getSession } from "auth/server";
import { chatRepository } from "lib/db/repository";
import { NextRequest } from "next/server";

function parsePaginationParams(request: NextRequest): {
  limit?: number;
  offset?: number;
} {
  const limitParam = request.nextUrl.searchParams.get("limit");
  const offsetParam = request.nextUrl.searchParams.get("offset");

  const limit =
    limitParam === null ? undefined : Number.parseInt(limitParam, 10);
  const offset =
    offsetParam === null ? undefined : Number.parseInt(offsetParam, 10);

  return {
    limit:
      limit !== undefined && Number.isFinite(limit) && limit > 0
        ? Math.min(limit, 100)
        : undefined,
    offset:
      offset !== undefined && Number.isFinite(offset) && offset >= 0
        ? offset
        : undefined,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();

  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { limit, offset } = parsePaginationParams(request);
  if (limit !== undefined || offset !== undefined) {
    const page = await chatRepository.selectThreadsPageByUserId(
      session.user.id,
      {
        limit: limit ?? 20,
        offset: offset ?? 0,
      },
    );
    return Response.json(page);
  }

  const threads = await chatRepository.selectThreadsByUserId(session.user.id);
  return Response.json(threads);
}
