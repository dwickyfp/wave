import { discoverA2AAgent } from "lib/a2a/client";
import { getSession } from "auth/server";
import { z } from "zod";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const config = await discoverA2AAgent(body);
    return Response.json(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to discover A2A agent:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to discover A2A agent",
      },
      { status: 502 },
    );
  }
}
