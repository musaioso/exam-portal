# NotebookLM Work Orders — Progress Ledger

This file is the shared channel between phase sessions. Chats cannot message
each other, so every phase reports here, and the **Phase 1 session** is the one
to return to for the overall picture.

- Plan: `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`
- Design: `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md`

## Automatic runner

```powershell
.\scripts\run-phases.ps1 -List      # status of every phase
.\scripts\run-phases.ps1 -DryRun    # check the wiring, spend no session
.\scripts\run-phases.ps1            # run every pending phase, one session each
.\scripts\run-phases.ps1 -From p3   # resume from a phase
```

Each phase runs in a fresh, named session (`ses-nbwo-p1-…`), reads its brief in
`plan/`, and writes `plan/state/pN.json`. The runner continues only on
`"status": "done"` and stops on `blocked`. See `plan/README.md`.

The runner is a port of `C:\Users\musaioso\remote\voice\run-phases.ps1`.

## Rules for every phase session

1. Read the design spec, the plan, and this file before doing anything.
2. Do only the phase named in your brief. Do not start another phase, even if
   you finish early.
3. Run that phase's tests and the verification commands the plan lists.
4. Update your phase row (status, commit range, anything unfinished), write
   `plan/state/pN.json`, and append one entry to the log at the bottom.
5. Stop and report back. The runner starts the next phase in a new session; if
   you were started by hand, the next phase is a new chat.

## Phase status

| Phase | Tasks | Status | Commit range | Notes |
|---|---|---|---|---|
| 1 — Foundation | 1–4 | done | 9278629..f79295b | schema, patterns, jobs API, progress |
| 2 — Work order | 5–7 | done | a53ea4e..e547512 | avoid list, renderer, endpoint |
| 3 — Reply import | 8–11 | done | edb0500..987b50b | sanitise, validate, atomic passage import, undo |
| 4 — UI | 12–14 | blocked on Phase 3 | — | NotebookLM tab, paste, runs |
| 5 — Patterns, docs | 15–16 | blocked on Phase 4 | — | pattern editor, end-to-end run |

## Start lines (manual fallback)

**Phase 1**

> Implement Phase 1 of the NotebookLM work orders plan. Read
> `docs/superpowers/plans/2026-11-23-notebooklm-work-orders.md`,
> `docs/superpowers/specs/2026-11-23-notebooklm-work-orders-design.md` and
> `docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md`.
> Do only Tasks 1–4. Run the tests listed for those tasks, update the Phase 1
> row and append a log entry, then stop.

**Phase 2**

> Implement Phase 2 of the NotebookLM work orders plan. Read the same three
> files. Phase 1 is complete — check the progress ledger first. Do only Tasks
> 5–7. Run the tests, update the Phase 2 row and append a log entry, then stop.

**Phase 3**

> Implement Phase 3 of the NotebookLM work orders plan. Read the same three
> files. Phases 1–2 are complete — check the progress ledger first. Do only
> Tasks 8–11. Run the tests, update the Phase 3 row and append a log entry,
> then stop.

**Phase 4**

> Implement Phase 4 of the NotebookLM work orders plan. Read the same three
> files. Phases 1–3 are complete — check the progress ledger first. Do only
> Tasks 12–14. Run the frontend checks, update the Phase 4 row and append a log
> entry, then stop.

**Phase 5**

> Implement Phase 5 of the NotebookLM work orders plan. Read the same three
> files. Phases 1–4 are complete — check the progress ledger first. Do only
> Tasks 15–16. Run the full verification, update the Phase 5 row and append a
> log entry, then stop.

## Log

- 2026-11-23 — Phase 0 (design + plan) done in the design chat. Design approved
  by the teacher. Plan written and self-reviewed. No code yet.
- 2026-11-23 — Phase runner added (`scripts/run-phases.ps1`, `plan/`), ported
  from `remote\voice\run-phases.ps1`. Listing, dry run and the done-gate were
  verified without spending a session.
- 2026-11-23 — Phase 1 done (Tasks 1–4, commits 9278629..f79295b): work-order
  schema, seeded patterns with CRUD, jobs API with runs, and stem-based
  progress are in; 106 backend tests and typecheck pass.
- 2026-11-23 — Phase 2 done (Tasks 5–7, commits a53ea4e..e547512):
  chapter-scoped avoid list, seven-section work-order renderer and
  `POST /api/jobs/:id/work-order` with stored runs are in; 114 backend tests
  and typecheck pass.
- 2026-11-23 — Phase 3 done (Tasks 8–11, commits edb0500..987b50b): reply
  sanitiser, per-kind row validation, atomic passage expansion with chapter and
  subject skip buckets, import and undo endpoints; undo keeps the run with
  `undone_at` and prunes exams; 135 backend tests and typecheck pass.
