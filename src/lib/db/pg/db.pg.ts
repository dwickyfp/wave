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
});

// Ensure all timestamps are stored/compared in UTC,
// so JavaScript new Date() (UTC) and CURRENT_TIMESTAMP are consistent.
pool.on("connect", (client) => {
  client.query(`SET timezone = '${process.env.TZ || "UTC"}'`);
});

export const pgDb = drizzlePg(pool, {
  //   logger: new MyLogger(),
});
