# Phase 3 — Reply import: sanitise, validate, import, undo

## What this is

MCQ Studio at the repository root. Phase 2 can produce a work order. This phase
takes the notebook's reply back: cleans it, validates it, expands a passage
into its part rows, refuses duplicates atomically, and can undo exactly one
run.

This is **phase 3 of 5**. Backend only; no UI. This is the phase where a
mistake costs the teacher's bank, so the tests matter more than speed.

- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`
- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Progress ledger: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`

Check the ledger first: phases 1 and 2 must say `done`. If not, stop.

## Tasks in scope

Do **Tasks 8–11 only**, in order:

1. **Reply sanitiser** — fences, prose, `[1]` citations, curly quotes, trailing
   commas. Test: `backend/test/jobs-sanitize.test.ts`.
2. **Row validation** — MCQ (4 unique options, A–D mapping), written rows
   (no options), passage shape and part marks. Test:
   `backend/test/jobs-validate.test.ts`.
3. **Import service** — passage expansion into `passage_group` rows, chapter
   and subject duplicate buckets, atomic passages, unit and row counters, dry
   run. Test: `backend/test/jobs-import.test.ts`.
4. **Import and undo endpoints** — 413 over 1 MB, 404/409 guards, undo keeps
   the run with `undone_at` and prunes exams. Test: `backend/test/jobs-undo.test.ts`.

Do not start Task 12 or any later task.

## Rules

- A passage is accepted or skipped **as a whole**. Never insert a partial
  ক–ঘ group; a skip counts once and names the colliding part.
- One reply carries one kind. A row of another kind is a failed row with a
  message, and nothing from it is inserted.
- `imported` is units, `imported_rows` is rows. A passage counts once.
- A page number is stored as a claim, never as verified.
- Undo must call `pruneQuestionsFromExams`, matching `bulk-delete` and
  `undoBatch`. The run row stays and is stamped `undone_at`.
- Do not change `POST /api/questions/bulk-import` or the strict
  `notebooklm-mcq-v1` behaviour; the existing test must stay green.
- Add every new test file to `backend/package.json`'s `test` script.

## Checks before you write the result

```powershell
cd backend
npm test
npm run typecheck
```

Both must pass, including `test/notebooklm-import.test.ts`, `test/batches-undo.test.ts`
and `test/corrections-apply.test.ts`.

## Write the result

Write `plan/state/p3.json`:

```json
{
  "phase": "p3",
  "status": "done",
  "summary": "one line, plain language",
  "checks": ["what you actually ran and what it returned"]
}
```

If blocked, write `"status": "blocked"` with the reason in `summary`, and stop.

Then update the progress ledger: set the Phase 3 row to `done` with the commit
range, and append one line under `## Log`.

## Report

Plain language, short. What an import now does with a real reply, what the
tests proved (especially the atomic-passage and undo cases), the commit range,
and anything phase 4 needs to know about the response shapes.
