# Worktree Sectors

Each sector is a separate git worktree + branch (`sector/<name>`) so multiple streams can develop in parallel. Run `npm install` in any worktree you open.

| Sector | Directory | Branch | Owns |
|---|---|---|---|
| backend | worktrees/backend | sector/backend | Express API, SQLite DB, auth, migrations, seeds |
| frontend | worktrees/frontend | sector/frontend | React UI, routing, theme, components, pages |
| content | worktrees/content | sector/content | NCTB 2025 subject/chapter seed data, sample questions |
| print | worktrees/print | sector/print | Printable papers, PDF layout, answer keys |
| exam | worktrees/exam | sector/exam | Exam engine, grading, student flows, results |

## Integration
Develop in a sector branch, then open a PR/merge into `main`. Avoid editing the same files across sectors; coordinate on shared contracts (API routes, types).