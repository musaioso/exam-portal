import "./env";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDb, run, all } from "../src/db/database";
import { migrate } from "../src/db/migrate";

test("migrate keeps existing question ids and count", async () => {
  const db = await getDb();
  await migrate();
  const subjectId = randomUUID();
  await run(db, "INSERT INTO subjects (id,name,slug,created_at) VALUES (?,?,?,?)",
    [subjectId, "Integrity Subject", `s-${subjectId}`, Date.now()]);
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const id = randomUUID();
    ids.push(id);
    await run(db, `INSERT INTO questions (id,subject_id,type,difficulty,prompt,options,answer,marks,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, subjectId, "mcq", "medium", `Question ${i}?`, JSON.stringify(["A", "B"]), "A", 1, Date.now()]);
  }
  const before = (await all(db, "SELECT id FROM questions WHERE subject_id=? ORDER BY id", [subjectId])).map((r: any) => r.id);
  assert.deepEqual(before, [...ids].sort());

  await migrate();

  const after = (await all(db, "SELECT id FROM questions WHERE subject_id=? ORDER BY id", [subjectId])).map((r: any) => r.id);
  assert.deepEqual(after, before);
  const cols = (await all(db, "PRAGMA table_info(questions)")).map((r: any) => r.name);
  for (const col of ["batch_id", "source_quote", "source_file", "verification", "verification_method", "section"]) {
    assert.ok(cols.includes(col), `missing column ${col}`);
  }
  for (const table of ["correction_runs", "correction_items", "question_revisions"]) {
    const rows = await all(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]);
    assert.equal(rows.length, 1, `missing table ${table}`);
  }
});

test("backupDatabaseFile copies the file", async () => {
  const { backupDatabaseFile } = await import("../src/db/backup");
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcq-backup-"));
  const src = path.join(dir, "source.db");
  fs.writeFileSync(src, "db-bytes");
  const dest = backupDatabaseFile(src, path.join(dir, "backups"), "test");
  assert.ok(dest && fs.existsSync(dest));
  assert.equal(fs.readFileSync(dest!, "utf8"), "db-bytes");
});
