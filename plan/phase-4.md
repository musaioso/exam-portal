# Phase 4 — NotebookLM tab UI

## What this is

MCQ Studio at the repository root. Phases 1–3 built the whole backend: jobs,
work orders, paste import, undo. This phase is the first one the teacher can
see — a third tab in Batch Studio.

This is **phase 4 of 5**.

- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`
- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Progress ledger: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`

Check the ledger first: phases 1–3 must say `done`. If not, stop.

## Tasks in scope

Do **Tasks 12–14 only**, in order:

1. **Client library** — `frontend/src/lib/jobs.ts`, typed, mirroring
   `frontend/src/lib/batch.ts`.
2. **NotebookLM tab** — job list with per-kind progress and last-run age, new
   job dialog, copy-prompt dialog. `frontend/src/pages/Batch.tsx` gains a third
   tab next to Generate and Correct.
3. **Paste reply, runs and unverified pages** — debounced dry-run preview,
   import result with both skip buckets, runs drawer with undo, and the
   unverified-page line.

Do not start Task 15 or Task 16.

## Rules

- `AGENTS.md` is binding: use `Input`, `Textarea`, `NumberInput`, `Select`,
  `Button`, `Field`, `Card`, `Badge`, `FileInput` from
  `frontend/src/components/ui.tsx`. No raw `<select>`, no raw file input, no
  hardcoded colours.
- Any new colour shade goes in both theme blocks in `frontend/src/theme.css`.
  Do not build colour classes dynamically.
- All new routes and UI are for `admin`/`teacher`.
- Use the shadcn-free house style already in `frontend/src/components/batch/`.
- Keep `Batch.tsx` thin: the tab content belongs in a component.
- Do not change backend routes in this phase unless the plan says a field is
  missing (the unverified-page count is the one allowed addition; add it to the
  job list response and to `Job` in `lib/jobs.ts` together).
- No placeholder UI. A button either works or is not rendered.

## Checks before you write the result

```powershell
cd frontend
npm run theme:check
npm run typecheck
npm run lint
npm run build
```

All four must pass. `npm run build` runs the theme check first, so a violation
would fail the Vercel deploy.

Then a short manual check with the backend and frontend running: create a job,
copy a prompt, paste a reply, open the runs drawer, undo the run.

## Write the result

Write `plan/state/p4.json`:

```json
{
  "phase": "p4",
  "status": "done",
  "summary": "one line, plain language",
  "checks": ["what you actually ran and what it returned"]
}
```

If blocked, write `"status": "blocked"` with the reason in `summary`, and stop.

Then update the progress ledger: set the Phase 4 row to `done` with the commit
range, and append one line under `## Log`.

## Report

Plain language, short. What the teacher can now do on screen, what the checks
returned, the commit range, and what phase 5 still needs.
