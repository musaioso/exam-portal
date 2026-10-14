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