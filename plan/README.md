# Phase runner

Automatic phase sessions for this repository, ported from
`C:\Users\musaioso\remote\voice\run-phases.ps1`.

Each phase in `plan/manifest.json` runs in its own **fresh, named OpenCode
session**, reads its own brief, and writes a result file the runner gates on.
A phase that reports `blocked` or writes nothing stops the run.

## Use

```powershell
# what exists and where it stands
.\scripts\run-phases.ps1 -List

# check the wiring without spending a session
.\scripts\run-phases.ps1 -DryRun

# the real thing
.\scripts\run-phases.ps1

# resume, or force a phase to run again
.\scripts\run-phases.ps1 -From p3
.\scripts\run-phases.ps1 -From p3 -Fresh

# a different model
.\scripts\run-phases.ps1 -Model opencode-go/deepseek-v4.1-flash
```

The default model is `opencode-go/deepseek-v4.1-flash`, overridable with the
`PHASE_RUNNER_MODEL` environment variable or `-Model`.

## Files

| Path | Purpose |
|---|---|
| `plan/manifest.json` | phase list: id, title, brief |
| `plan/phase-N.md` | the brief a phase session reads; authoritative for scope |
| `plan/state/pN.json` | the result a phase writes; the runner's gate |
| `plan/state/pN.log` | that session's output |
| `plan/state/run.lock` | prevents two runs at once |

`plan/state/*.log` and the lock are ignored by git; the result JSONs are kept
as evidence.

## Relationship to the progress ledger

`docs/superpowers/plans/2026-11-23-notebooklm-work-orders-progress.md` is the
human channel between phases. The result JSON is the machine gate. Every brief
asks the session to write both: the JSON so the runner can continue, the ledger
so the owner can read the story in one place.

## Notes

- The brief body never rides on the command line; PowerShell 5.1 splits native
  arguments on embedded quotes and the briefs quote JSON. The session is told
  to read its brief from disk.
- Each attempt gets a unique session id
  (`ses-nbwo-<phase>-<timestamp>`), so a retry is visibly a new chat and no
  phase inherits another phase's context.
- Do not run two phase runners at once; the lock refuses the second.
