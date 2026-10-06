import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";

// Every timeout here exists because of a real production incident: a DB
// connection silently died around a deploy, the next query on it hung
// FOREVER (no default timeouts in pg), and that hung await held a swing-bot
// strategy lock — freezing the bot mid-run and blocking Stop & withdraw.
// All external calls (RPC, Jupiter, DexScreener) carry deadlines; the
// database must too.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10_000, // waiting for a free/new connection
  query_timeout: 60_000,           // client-side: no query may hang > 60s
  statement_timeout: 60_000,       // server-side backstop for the same
  keepAlive: true,                 // detect silently-dropped sockets
});

export const db = drizzle(pool, { schema });
