// import { Logger } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";

// class MyLogger implements Logger {
//   logQuery(query: string, params: unknown[]): void {
//     console.log({ query, params });
//   }
// }

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL!,
  max: 10,
  // Fail fast if no connection is available rather than hanging indefinitely
  connectionTimeoutMillis: 10_000,
  // Release idle connections after 30s (avoids reusing server-terminated sockets)
  idleTimeoutMillis: 30_000,
  // TCP keepalive prevents network middleboxes / the server from silently
  // dropping idle connections (root cause of "Connection terminated unexpectedly")
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
});

// Prevent unhandled-rejection crashes when a connection errors while idle in the pool
pool.on("error", (err) => {
  console.error("[pg] Unexpected error on idle client", err.message);
});

// Ensure all timestamps are stored/compared in UTC,
// so JavaScript new Date() (UTC) and CURRENT_TIMESTAMP are consistent.
pool.on("connect", (client) => {
  client.query(`SET timezone = '${process.env.TZ || "UTC"}'`).catch((err) => {
    console.error("[pg] Failed to set timezone on new client", err.message);
  });
});

export const pgDb = drizzlePg(pool, {
  //   logger: new MyLogger(),
});
