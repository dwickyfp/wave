import { colorize } from "consola/utils";
import "load-env";

const { runMigrate } = await import("lib/db/pg/migrate.pg");

function extractErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const anyErr = err as any;
  return (
    anyErr.cause?.message ||
    anyErr.message ||
    (typeof anyErr.cause === "string" ? anyErr.cause : "") ||
    String(err)
  );
}

function isLikelySchemaDrift(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("already exists") ||
    m.includes("duplicate column") ||
    m.includes("duplicate key") ||
    m.includes("relation") ||
    m.includes("does not exist") ||
    m.includes('type "vector" does not exist')
  );
}

await runMigrate()
  .then(() => {
    console.info("🚀 DB Migration completed");
    process.exit(0);
  })
  .catch((err) => {
    const msg = extractErrorMessage(err);
    console.error(err);
    console.error(`\n${colorize("red", "Migration error details:")} ${msg}\n`);

    if (isLikelySchemaDrift(msg)) {
      console.warn(
        `
${colorize("yellow", "⚠️  Migration failed due to schema drift (not necessarily full incompatibility).")}

Recommended fixes:
1. If you previously used 'db:push', keep this migration idempotent and run:
   ${colorize("green", "pnpm db:migrate")}
2. If extension error appears (e.g. vector type), ensure pgvector exists in your DB.
3. If drift is severe and you are in local/dev only, then consider reset:
   ${colorize("green", "pnpm db:reset")}
        `.trim(),
      );
    } else {
      console.warn(
        `
${colorize("red", "🚨 DB migration failed.")}

Run again after checking:
- Database connectivity / POSTGRES_URL
- Pending migration SQL syntax and permissions
        `.trim(),
      );
    }

    process.exit(1);
  });
