import { getDb, get, run } from "../../db/database";

/**
 * Server-side store for provider API keys entered from the UI's key manager.
 *
 * Rows live in app_meta (key: "ai_key_<provider>"). Keys are resolved
 * env-first (backend/.env wins, e.g. on Vercel) and only fall back to this
 * store, so a deployment can keep using plain environment variables.
 * Nothing in the API ever returns a stored key — only a masked hint — and
 * values must never be logged.
 */

const rowKey = (providerId: string) => `ai_key_${providerId}`;

export async function getStoredKey(providerId: string): Promise<string | undefined> {
  try {
    const db = await getDb();
    const row = (await get(db, "SELECT value FROM app_meta WHERE key=?", [rowKey(providerId)])) as any;
    const v = row?.value;
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined; // a meta read failure must not take the gateway down
  }
}

export async function setStoredKey(providerId: string, key: string): Promise<void> {
  const db = await getDb();
  await run(db, "INSERT OR REPLACE INTO app_meta (key,value) VALUES (?,?)", [rowKey(providerId), key.trim()]);
}

export async function deleteStoredKey(providerId: string): Promise<void> {
  const db = await getDb();
  await run(db, "DELETE FROM app_meta WHERE key=?", [rowKey(providerId)]);
}
