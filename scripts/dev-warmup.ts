/**
 * Dev warmup script — pre-compiles all static routes by sending requests
 * to the running Next.js dev server.
 *
 * Usage: pnpm dev:warmup
 * (run this in a second terminal after `pnpm dev:turbopack` is ready)
 */

const BASE_URL = process.env.WARMUP_URL ?? "http://localhost:3000";
const CONCURRENCY = 3;
const TIMEOUT_MS = 30_000;

// All static (non-dynamic) routes derived from src/app
const STATIC_ROUTES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/sign-up/email",
  "/agents",
  "/mcp",
  "/mcp/create",
  "/workflow",
  "/admin/usage-monitoring",
  "/admin/users",
];

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
  console.log(`\nDev warmup — ${BASE_URL}\n`);
  await waitForServer();
  console.log(`\nPre-compiling ${STATIC_ROUTES.length} routes...\n`);
  const start = Date.now();
  await runBatch(STATIC_ROUTES);
  console.log(`\nDone in ${((Date.now() - start) / 1000).toFixed(1)}s\n`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
