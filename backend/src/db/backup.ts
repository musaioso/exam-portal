import fs from "node:fs";
import path from "node:path";

/** Copy a local SQLite file before a schema migration. Returns the backup path. */
export function backupDatabaseFile(sourcePath: string, destDir: string, label: string): string | null {
  if (!fs.existsSync(sourcePath)) return null;
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `mcq-${label}-${Date.now()}.db`);
  fs.copyFileSync(sourcePath, dest);
  return dest;
}
