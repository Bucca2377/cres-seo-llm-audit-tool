import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/**
 * Shared roster store (cross-device sync).
 *
 * The app otherwise keeps every property in each browser's localStorage, so two
 * devices never see the same data. This endpoint persists the property records
 * to a shared Postgres so the whole team — all behind the one site password —
 * works off the same roster. Each property is one row (id + JSONB), upserted
 * independently, so two people editing DIFFERENT properties never clobber each
 * other. "Which property am I viewing" (activeId) is intentionally NOT stored
 * here — that stays per-device.
 *
 * Storage is keyed off DATABASE_URL (injected by the Railway Postgres plugin).
 * With no DATABASE_URL the endpoint reports `enabled: false` and the client
 * silently falls back to local-only mode — so the app keeps working with or
 * without the database provisioned.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

function getPool(): Pool | null {
  const url = process.env.DATABASE_URL || process.env["DATABASE_URL"];
  if (!url) return null;
  if (!pool) {
    // Railway's private network URL (postgres.railway.internal) needs no SSL;
    // its public proxy URL (…​.proxy.rlwy.net) does.
    const needsSsl = /proxy\.rlwy\.net|sslmode=require/i.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return pool;
}

async function ensureSchema(p: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = p
      .query(
        `CREATE TABLE IF NOT EXISTS properties (
           id text PRIMARY KEY,
           data jsonb NOT NULL,
           updated_at timestamptz NOT NULL DEFAULT now()
         )`
      )
      .then(() => undefined)
      .catch((e) => {
        // Reset so a transient failure can be retried on the next request.
        schemaReady = null;
        throw e;
      });
  }
  return schemaReady;
}

/** GET → { enabled, properties }. properties is [] when the store is empty. */
export async function GET() {
  const p = getPool();
  if (!p) return NextResponse.json({ enabled: false, properties: [] });
  try {
    await ensureSchema(p);
    const { rows } = await p.query("SELECT data FROM properties ORDER BY updated_at ASC");
    return NextResponse.json({ enabled: true, properties: rows.map((r) => r.data) });
  } catch (e) {
    return NextResponse.json(
      { enabled: false, properties: [], error: (e as Error).message },
      { status: 500 }
    );
  }
}

/**
 * PUT { property } or { properties: [...] } → upsert one or many rows.
 * Each item must carry a string `id`. Non-conforming items are skipped.
 */
export async function PUT(req: NextRequest) {
  const p = getPool();
  if (!p) return NextResponse.json({ enabled: false });
  try {
    await ensureSchema(p);
    const body = (await req.json()) as { property?: unknown; properties?: unknown };
    const raw = Array.isArray(body?.properties)
      ? body.properties
      : body?.property
      ? [body.property]
      : [];
    const items = raw.filter(
      (it): it is { id: string } & Record<string, unknown> =>
        !!it && typeof it === "object" && typeof (it as { id?: unknown }).id === "string" && !!(it as { id: string }).id
    );
    for (const it of items) {
      await p.query(
        `INSERT INTO properties (id, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [it.id, JSON.stringify(it)]
      );
    }
    return NextResponse.json({ enabled: true, saved: items.length });
  } catch (e) {
    return NextResponse.json({ enabled: true, error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE ?id=... → remove one row. */
export async function DELETE(req: NextRequest) {
  const p = getPool();
  if (!p) return NextResponse.json({ enabled: false });
  try {
    await ensureSchema(p);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
    await p.query("DELETE FROM properties WHERE id = $1", [id]);
    return NextResponse.json({ enabled: true, deleted: id });
  } catch (e) {
    return NextResponse.json({ enabled: true, error: (e as Error).message }, { status: 500 });
  }
}
