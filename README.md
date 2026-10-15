# MCQ Studio

Chapter-based question bank, exam, and printable paper platform for NCTB 2025 (English Version) subjects.

## Subjects
Bangla 1st/2nd Paper, English 1st/2nd Paper, Religion, ICT, Bangladesh and Global Studies.

## Run (development)
Backend:
```
cd backend
npm install
npm run seed
npm run dev   # http://localhost:4000
```
Frontend:
```
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Demo accounts (after seed):
- admin@mcq.local / admin123
- teacher@mcq.local / teacher123
- student@mcq.local / student123

## Worktrees (parallel sectors)
```
git worktree list
```
Sectors:
- main (integration)
- worktrees/backend  -> sector/backend   (API, DB, auth)
- worktrees/frontend -> sector/frontend  (UI, pages, theme)
- worktrees/content  -> sector/content   (NCTB subjects, chapters, seed data)
- worktrees/print    -> sector/print     (printable papers, PDF layout)
- worktrees/exam     -> sector/exam     (exam engine, grading, student flow)

Each worktree is a separate directory/branch; run `npm install` inside it before developing. Merge sector branches into `main` when ready.

## Features
- Role-based auth (admin/teacher/student)
- Subject & chapter management
- Question bank: MCQ, short, long
- Exam builder + online attempt + auto-grading (MCQ)
- Printable question papers with answer key & mark scheme
- Modern dark theme (Tailwind)

## Deploy (GitHub + Vercel)

Everything runs on **Vercel** from this one repo, as two [Vercel Services](https://vercel.com/docs/services):

- `frontend/` — React + Vite SPA, built to `frontend/dist` (static).
- `backend/` — the Express + SQLite API, deployed as an Express service.

`vercel.json` wires them together (one domain, `/api/*` → backend, everything else → SPA).

### Persistent data (recommended)
Data is stored in a **Turso** (libSQL) database, so it is shared across all
serverless instances and survives redeploys and cold starts:

1. In the Vercel project → **Storage** → create/connect a **Turso** database
   (or create one at [turso.tech](https://turso.tech) and copy its URL + token).
2. Set these environment variables on the project (Vercel's Turso integration
   adds them automatically):
   - `TURSO_DATABASE_URL` — e.g. `libsql://your-db.turso.io`
   - `TURSO_AUTH_TOKEN`
3. Redeploy.

Without a Turso database the backend falls back to an in-memory SQLite database
that is recreated (and reseeded with the demo data) on every cold start — the
site still works, but user-created data is not durable.

### 1. Push to GitHub
```
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Import on Vercel
- New Project → Import the GitHub repo.
- Build settings come from `vercel.json`.
- **Environment Variables**: set the Turso ones above (optional but recommended);
  optionally set `JWT_SECRET` so login tokens stay valid across deployments.
- Deploy.

### Always-latest workflow
Merge your chat/worktree changes into `main` and push. Vercel rebuilds and the
live URL reflects the latest version within ~1 minute.