# Phase 1 — Foundation: schema, patterns, jobs, progress

## What this is

MCQ Studio at the repository root. The teacher generates questions in Google
NotebookLM and imports them; the goal of this work is saved per-chapter
**work orders** so the prompt, targets and history never have to be
reconstructed by hand.

This is **phase 1 of 5**. It builds the database foundation and the backend
surface only. No UI. Later phases depend on the names and shapes this phase
creates, so follow the plan's Interfaces blocks exactly.

- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`
- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Progress ledger: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`

Read all three before touching code. The plan is authoritative for steps and
signatures; the ledger is the shared channel between phase sessions.

## Tasks in scope

Do **Tasks 1–4 only**, in order:

1. **Schema and migration** — three tables, six nullable columns on `questions`,
   five indexes, `SCHEMA_VERSION` `"17"` → `"18"`. Test: `backend/test/jobs-schema.test.ts`.
2. **Patterns service, seed and API** — `/api/patterns` CRUD, idempotent seed of
   the three known patterns. Test: `backend/test/patterns.test.ts`.
3. **Jobs API** — `/api/jobs` CRUD and `/:id/runs`. Test: `backend/test/jobs-api.test.ts`.
4. **Job progress** — `deriveLegacyStem`, `jobProgress`, attach progress to
   `listJobs`, counting legacy CQ rows. Test: `backend/test/jobs-progress.test.ts`.

Do not start Task 5 or any later task.

## Rules

- Follow each task's steps in order: failing test, run it and see it fail,
  implement, run it and see it pass, commit.
- Every new test file must be added to the `test` script in
  `backend/package.json`, or `npm test` will not run it.
- Migrations are additive only. Never rewrite, re-key or delete an existing
  question. `questions.type` is unchanged.
- Global Constraints in the plan apply to every task. Exam label `SSC 2027`,
  short 2 marks, Bangla উপন্যাস/নাটক 3+7.
- Backend only. Do not touch `frontend/`.
- If a test cannot be made to pass without changing an existing behaviour the
  spec did not ask you to change, stop and report rather than widening scope.

## Checks before you write the result

```powershell
cd backend
npm test
npm run typecheck
```

Both must pass. `npm test` runs the whole backend suite, including the existing
migration and NotebookLM importer tests, which must stay green.

## Write the result

Write `plan/state/p1.json`:

```json
{
  "phase": "p1",
  "status": "done",
  "summary": "one line, plain language",
  "checks": ["what you actually ran and what it returned"]
}
```

If blocked, write `"status": "blocked"` with the reason in `summary`, and stop.

Then update the progress ledger: set the Phase 1 row to `done` with the commit
range, and append one line under `## Log` with the date, the phase and a
one-sentence outcome.

## Report

Plain language, short. What exists now, what the tests proved, the commit
range, and anything phase 2 needs to know.
