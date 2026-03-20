/**
 * Dev warmup script — pre-compiles all static routes by sending requests
 * to the running Next.js dev server.
 *
 * Usage: pnpm dev:warmup
 * (run this in a second terminal after `pnpm dev:turbopack` is ready)
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.WARMUP_URL ?? "http://localhost:3000";
const CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;
const APP_DIR = path.resolve("src/app");

const ROUTE_VARIANTS = [
  "/",
  "/sign-in",
  "/sign-up",
  "/sign-up/email",
  "/agents",
  "/mcp",
  "/mcp/create",
  "/workflow",
  "/knowledge",
  "/skills",
  "/teams",
  "/admin/usage-monitoring",
  "/admin/usage-monitoring?range=7d",
  "/admin/users",
  "/admin/users?page=1&limit=20",
  "/admin/evaluation",
  "/admin/evaluation?page=1&limit=20",
  "/api/auth/error?error=access_denied",
];

type RouteEntry = {
  route: string;
  source: string;
};

function normalizeRoute(route: string): string {
  if (!route || route === "/page") return "/";

  const normalized = route
    .replace(/\\/g, "/")
    .replace(/\/page$/, "")
    .replace(/\/route$/, "")
    .split("/")
    .filter(Boolean)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .filter((segment) => segment !== "index")
    .join("/")
    .trim();

  if (!normalized || normalized === "/") return "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function isWarmableAppPage(relativePath: string): boolean {
  if (!relativePath.endsWith("page.tsx")) return false;
  if (relativePath.includes("[")) return false;
  return true;
}

async function collectAppPages(
  dir: string,
  prefix = "",
): Promise<RouteEntry[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const pages: RouteEntry[] = [];

  for (const entry of entries) {
    const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const nextPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      pages.push(...(await collectAppPages(nextPath, nextPrefix)));
      continue;
    }

    if (!isWarmableAppPage(nextPrefix)) {
      continue;
    }

    pages.push({
      route: normalizeRoute(nextPrefix.replace(/\/page\.tsx$/, "")),
      source: nextPrefix,
    });
  }

  return pages;
}

async function getWarmupRoutes(): Promise<string[]> {
  const discoveredPages = await collectAppPages(APP_DIR);
  const routeMap = new Map<string, string>();

  for (const page of discoveredPages) {
    routeMap.set(page.route, page.source);
  }

  for (const route of ROUTE_VARIANTS) {
    routeMap.set(route, "manual-variant");
  }

  return [...routeMap.keys()].sort((left, right) => {
    if (left === "/") return -1;
    if (right === "/") return 1;
    return left.localeCompare(right);
  });
}

async function waitForServer(maxWaitMs = 60_000): Promise<void> {
  const start = Date.now();
  process.stdout.write("Waiting for dev server");
  while (Date.now() - start < maxWaitMs) {
    try {
      await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
      process.stdout.write(" ready!\n");
      return;
    } catch {
      process.stdout.write(".");
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw new Error(`Dev server did not respond within ${maxWaitMs}ms`);
}

async function warmRoute(route: string): Promise<void> {
  const url = `${BASE_URL}${route}`;
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "x-warmup": "1" },
    });
    const ms = Date.now() - start;
    const status = res.status;
    const icon = status < 400 ? "✓" : "✗";
    console.log(`  ${icon} ${route.padEnd(40)} ${status}  ${ms}ms`);
  } catch (_err) {
    const ms = Date.now() - start;
    console.log(`  ✗ ${route.padEnd(40)} ERROR  ${ms}ms`);
  }
}

async function runBatch(routes: string[]): Promise<void> {
  for (let i = 0; i < routes.length; i += CONCURRENCY) {
    await Promise.all(routes.slice(i, i + CONCURRENCY).map(warmRoute));
  }
}

async function main() {
  const warmupRoutes = await getWarmupRoutes();
  console.log(`\nDev warmup — ${BASE_URL}\n`);
  await waitForServer();
  console.log(`\nPre-compiling ${warmupRoutes.length} routes...\n`);
  const start = Date.now();
  await runBatch(warmupRoutes);
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
