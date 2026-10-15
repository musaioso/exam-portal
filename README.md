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

## Deploy (GitHub + Vercel + backend host)

The app is two parts:
- `frontend/` — React + Vite static SPA → **Vercel** (auto-deploys on every push).
- `backend/` — Express + SQLite (sql.js) → a Node host with a persistent disk
  (**Render** / Railway / Fly.io). Vercel serverless cannot persist the SQLite
  file, so the API must live elsewhere.

### 1. Push to GitHub
```
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Deploy the backend (Render)
- New + → Blueprint → pick the repo (uses `render.yaml`), **or** create a Web
  Service with root directory `backend`, build `npm install && npm run build`,
  start `npm start`.
- Env vars: `JWT_SECRET` (generate), `DB_PATH=/var/data/mcq.db`,
  `CORS_ORIGIN=https://<your-app>.vercel.app` (comma-separate multiple origins).
- Seed the demo data once from the Render shell: `npm run seed`.
- Free plan has an ephemeral disk — data resets on redeploy. Attach a persistent
  disk mounted at `/var/data` (paid) to keep data.

### 3. Deploy the frontend (Vercel)
- New Project → import the repo → **Root Directory = `frontend`**.
- Framework preset: Vite (build `npm run build`, output `dist`).
- Env var: `VITE_API_URL=https://<your-backend>.onrender.com/api`.
- Deploy. Every push to `main` triggers an instant redeploy.

### Always-latest workflow
Work in any chat/worktree, then merge into `main` and push. Vercel rebuilds and
the live URL reflects the latest version within ~1 minute.