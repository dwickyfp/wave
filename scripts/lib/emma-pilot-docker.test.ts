import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("emma pilot docker packaging", () => {
  it("builds Emma Pilot artifacts in the app Dockerfile", () => {
    const dockerfile = readFileSync(
      path.join(process.cwd(), "docker", "Dockerfile"),
      "utf8",
    );

    expect(dockerfile).toContain("apk add --no-cache zip");
    expect(dockerfile).toContain("RUN pnpm build:emma-pilot");
  });

  it("passes the Emma Pilot backend origin through docker compose build args", () => {
    const compose = readFileSync(
      path.join(process.cwd(), "docker", "compose.yml"),
      "utf8",
    );

    expect(compose).toContain("EMMA_PILOT_BACKEND_ORIGIN");
  });
});
