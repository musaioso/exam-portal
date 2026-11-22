# Phase 2 — Work orders: avoid list, renderer, endpoint

## What this is

MCQ Studio at the repository root. Phase 1 created the tables, patterns, jobs
and progress. This phase makes the site able to **write the instruction the
teacher currently retypes by hand**: a work order containing the exam label,
the chapter, the format, the remaining count, and a list of what already
exists.

This is **phase 2 of 5**. Backend only; no UI.

- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`
- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Progress ledger: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`

Check the ledger first: phase 1 must say `done`. If it does not, stop.

## Tasks in scope

Do **Tasks 5–7 only**, in order:

1. **Avoid list** — chapter-scoped, kind-aware, newest first, 120-character
   trim, 200-entry cap with a chapter-summary fallback. Includes stems derived
   from legacy `উদ্দীপক:` prompts. Test: `backend/test/jobs-avoid.test.ts`.
2. **Work-order renderer** — `renderWorkOrder`, seven sections, per-kind JSON
   contract, no fences. Test: `backend/test/jobs-work-order.test.ts`.
3. **Work-order endpoint** — `POST /api/jobs/:id/work-order` creates and stores
   a `generation_runs` row with the exact prompt text. Test:
   `backend/test/jobs-work-order-api.test.ts`.

Do not start Task 8 or any later task.

## Rules

- Consume phase 1's names exactly: `JobRecord`, `PatternRecord`,
  `deriveLegacyStem`, `jobProgress`, `chapterAvoidList`. Do not rename them.
- The avoid list is chapter-scoped. Duplicate checking elsewhere stays
  subject-wide; do not change the importer.
- One reply later carries one kind; the work order asks for one kind.
- The page instruction must say a guess is worse than `null`.
- Add every new test file to `backend/package.json`'s `test` script.
- Backend only. Do not touch `frontend/`.
- If a test needs a different signature than the plan's Interfaces block, stop
  and report rather than inventing a parallel one.

## Checks before you write the result

```powershell
cd backend
npm test
npm run typecheck
```

Both must pass, with the phase 1 tests still green.

## Write the result

Write `plan/state/p2.json`:

```json
{
  "phase": "p2",
  "status": "done",
  "summary": "one line, plain language",
  "checks": ["what you actually ran and what it returned"]
}
```

If blocked, write `"status": "blocked"` with the reason in `summary`, and stop.

Then update the progress ledger: set the Phase 2 row to `done` with the commit
range, and append one line under `## Log`.

## Report

Plain language, short. What a work order now contains, what the tests proved,
the commit range, and anything phase 3 needs to know.
