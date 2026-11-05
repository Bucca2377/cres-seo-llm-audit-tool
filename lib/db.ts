import { Pool } from "pg";

/**
 * Shared Postgres pool (Railway DATABASE_URL), or null when no database is
 * configured, in which case callers skip their DB step. Same SSL rule as the
 * roster store: the private network URL needs none, the public proxy does.
 */
let pool: Pool | null = null;
export function getPool(): Pool | null {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  if (!pool) {
    const needsSsl = /proxy\.rlwy\.net|sslmode=require/i.test(url);
    pool = new Pool({ connectionString: url, ssl: needsSsl ? { rejectUnauthorized: false } : undefined, max: 3 });
  }
  return pool;
}
