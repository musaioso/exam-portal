# Phase 5 — Pattern editor, docs, end-to-end

## What this is

MCQ Studio at the repository root. Phases 1–4 deliver the backend and the
NotebookLM tab. This phase closes the loop: the teacher can add or edit a
question format without anyone touching the database, the docs match the new
flow, and the two real chapter shapes are proven end to end.

This is **phase 5 of 5**, the last one.

- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`
- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Progress ledger: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`

Check the ledger first: phases 1–4 must say `done`. If not, stop.

## Tasks in scope

Do **Tasks 15–16 only**, in order:

1. **Pattern editor** — modal list/add/edit/delete for name, subject,
   chapter-title match and parts with kind and marks. Reached from the
   NotebookLM tab.
2. **Docs and end-to-end** — rewrite the NotebookLM import section of
   `docs/batch-studio.md` for the job flow (keeping the JSON template link for
   the legacy file import), update `README.md`, and run the manual checks.

## Rules

- `AGENTS.md` is binding for the editor: shared `ui.tsx` controls, colours from
  `theme.css`, both theme blocks.
- The editor must not let a pattern become invalid: at least one part, positive
  integer marks, a passage with 2–6 parts. The backend already rejects these;
  the UI must not send them.
- Deleting a pattern must not delete a job; the job loses its pattern reference
  (`ON DELETE SET NULL`) and the list must still render.
- Keep the legacy file import documented; do not delete the template.
- The docs must state that counters are in stems, that a passage imports as one
  group, and that the audit is what verifies a page number.

## Manual end-to-end (record each result in `checks`)

1. BGS Ch 3: create a job `MCQ 20 · CQ 6 · short 5`.
2. Copy the MCQ prompt; paste a 3-question reply containing ` ```json ` fences
   and `[1]` markers; confirm 3 imported and progress moved.
3. Paste the identical reply again; confirm it is skipped, not failed.
4. Copy the CQ prompt; paste two passages; confirm 8 rows, four parts each, one
   group per passage.
5. Undo the CQ run; confirm 8 rows gone and the run shows **undone**.
6. Bangla 1st উপন্যাস chapter: confirm the pattern is the 3+7 one and the prompt
   contains no MCQ or four-part CQ.
7. Restart the backend; confirm the job still shows its counts and its stored
   prompt.

## Checks before you write the result

```powershell
cd backend
npm test
npm run typecheck

cd ..\frontend
npm run theme:check
npm run typecheck
npm run lint
npm run build
```

All must pass.

## Write the result

Write `plan/state/p5.json`:

```json
{
  "phase": "p5",
  "status": "done",
  "summary": "one line, plain language",
  "checks": ["what you actually ran and what it returned"]
}
```

If blocked, write `"status": "blocked"` with the reason in `summary`, and stop.

Then update the progress ledger: set the Phase 5 row to `done` with the commit
range, append one line under `## Log`, and add a closing line that the build is
complete and what remains deferred (chunk 3: grouping in exams and print).

## Report

Plain language, short. What the teacher can do now that they could not before,
which of the seven manual checks passed, and the deferred chunk 3 items.
