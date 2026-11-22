import "./env";
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { getDb, all } from "../src/db/database";
import { startServer } from "./helpers";

let server: Awaited<ReturnType<typeof startServer>>;
before(async () => { server = await startServer(); });
after(async () => { await server.close(); });

test("creates the work-order tables, columns and indexes", async () => {
  const db = await getDb();
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map((r: any) => r.name);
  for (const t of ["question_patterns", "generation_jobs", "generation_runs"]) assert.ok(tables.includes(t), t);
  const cols = (await all(db, "PRAGMA table_info(questions)")).map((r: any) => r.name);
  for (const c of ["job_id", "generation_run_id", "passage_group", "passage_stem", "passage_part", "passage_index"]) {
    assert.ok(cols.includes(c), c);
  }
  const runCols = (await all(db, "PRAGMA table_info(generation_runs)")).map((r: any) => r.name);
  for (const c of ["requested", "prompt_text", "imported", "imported_rows", "skipped", "failed", "undone_at"]) {
    assert.ok(runCols.includes(c), c);
  }
  const indexes = (await all(db, "SELECT name FROM sqlite_master WHERE type='index'")).map((r: any) => r.name);
  for (const i of ["idx_jobs_subject_chapter", "idx_runs_job", "idx_questions_job", "idx_questions_run", "idx_questions_passage_group"]) {
    assert.ok(indexes.includes(i), i);
  }
});
