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

Everything runs on **Vercel** from this one repo:

- `frontend/` — React + Vite SPA, built to `frontend/dist` (static).
- `api/[...path].ts` — a single serverless function that serves the whole Express API.
- `backend/` — the Express + SQLite (sql.js) code that the function imports.

`vercel.json` wires it together (install, build, SPA fallback that leaves `/api/*`
to the function). On Vercel the SQLite database is **in-memory and ephemeral**:
on every cold start the schema is recreated and the demo data is reseeded
automatically, so the deployed demo is always usable — but user-created data does
not persist between cold starts.

> Need durable data? Host the API on a platform with a persistent disk (see
> `render.yaml`) and set `VITE_API_URL` to that API on Vercel.

### 1. Push to GitHub
```
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Import on Vercel
- New Project → Import the GitHub repo.
- **Root Directory**: leave as the repo root (default).
- **Framework Preset**: Other.
- Build/install/output come from `vercel.json` (builds `frontend`, outputs `frontend/dist`).
- **Environment Variables**: none required. Optionally set `JWT_SECRET` so login
  tokens stay valid across deployments.
- Deploy.

### Always-latest workflow
Merge your chat/worktree changes into `main` and push. Vercel rebuilds and the
live URL reflects the latest version within ~1 minute.