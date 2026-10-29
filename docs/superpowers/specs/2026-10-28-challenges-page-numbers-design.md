# Design: source page numbers, question challenges, attempt deletion

Date: 2026-10-28
Status: awaiting approval

## Intent

Students reviewing an exam, or practising questions, should be able to see the
book page a question came from, challenge an answer they believe is wrong, and
have that challenge go somewhere a teacher can see and answer. Teachers and
admins should be able to remove a student's attempt so a mis-taken paper does
not distort the leaderboard.

The first and third items are small. The challenge flow is the real feature.

## What exists today

- `questions` already stores `page` (free text, e.g. `"42-43"`) and
  `page_number` (numeric). The question editor and the printed answer key
  already use them.
- The post-exam review endpoint (`GET /api/exams/attempts/:attemptId/review`)
  returns the prompt, options, given answer, correctness, key and explanation —
  but not the page.
- Standalone practice (`GET /api/questions/practice`) also omits the page.
- Missed-question practice (`/practice/:attemptId`) reuses the review endpoint.
- There is no challenge concept anywhere.
- Attempts have no delete endpoint. The leaderboard is computed from the
  `results` table, so removing an attempt's `results` row removes it from the
  leaderboard.
- The frontend has reusable `Card`, `Button`, `Input`, `Textarea`, `Badge`,
  `confirmDialog` and `useToast` pieces.

## Goals

1. Show the source/book page beside each question in post-exam review and in
   both practice flows, whenever the question has one.
2. Let a signed-in student challenge a question from exam review, missed-question
   practice, or standalone practice, with a written reason.
3. Give students a page where they can see their challenges and the staff reply.
4. Give teachers/admins an inbox of challenges, with filters and
   accept/reject + reply.
5. Let teachers/admins delete an attempt from Results, with confirmation, so it
   disappears from the student's results and the leaderboard.

## Non-goals

- No automatic correction of a question's answer key when a challenge is
  accepted. Staff fix the key in the question editor separately.
- No automatic re-scoring of past attempts.
- No notifications (email, push, in-app badge counts).
- No challenge before an exam is submitted; challenges happen after feedback.
- No attachments, per-option challenges, or student editing/deleting of
  challenges.
- No bulk deletion of attempts.

## Anti-goals

- Never expose the answer key to a student while an attempt is still
  `in_progress`.
- A challenge must never change a score or the leaderboard by itself.
- Deleting an attempt must require explicit confirmation; no silent one-click
  removal from a list.
- The challenge inbox must not become a second, independent copy of the
  question bank; it links back to the existing question.

## Constraints

- Backend: Express + the project's `sql.js`/Turso wrapper (`get`, `all`, `run`,
  `execScript`), schema in `backend/src/db/migrate.ts` with `SCHEMA_VERSION`.
- Frontend: React 19, React Router, Tailwind, existing UI components. Bengali is
  used for student-facing feedback; page chrome and staff tools are English.
- Auth roles: `student`, `teacher`, `admin`.
- API prefix `/api`.

## Approaches considered

1. **Challenge inbox page (chosen).** A reusable inline challenge form on the
   review and practice screens, a `question_challenges` table, and a
   `/challenges` page for everyone: students see their own history; staff see
   the inbox and resolve items. One home for exam and practice challenges.
2. **Inline flags only.** Same form and table, but staff resolve inside the
   Results review. Less work, but standalone-practice challenges have no home
   and students never see the reply.
3. **Auto-correct and recalculate.** Accepting a challenge rewrites the key and
   recalculates affected attempts. Rejected: one wrong accept changes history
   and the leaderboard, and the app has no audit/reversal flow.

Chosen: 1, with reply-only resolution. Deleting attempts is a separate small
feature.

## Design

### 1. Source page in review and practice

**Backend**

- `GET /api/exams/attempts/:attemptId/review`: add `page` and `page_number` to
  each returned question.
- `GET /api/questions/practice`: add `q.page, q.page_number` to the selected
  columns.
- No schema change; the columns already exist.

**Frontend**

- Add a small helper in `frontend/src/lib/labels.ts`:
  `sourcePage(q)` returns the trimmed `page` if present, else the trimmed
  `page_number`, else `""`.
- Results review (`frontend/src/pages/Results.tsx`): when `sourcePage(q)` is
  non-empty, show `বইয়ের পৃষ্ঠা <page>` as a subtle line under the prompt,
  beside the marks. Ranges such as `42-43` are shown verbatim.
- Missed-question practice (`frontend/src/pages/Practice.tsx`): show the same
  line under the prompt.
- Standalone practice (`frontend/src/pages/StandalonePractice.tsx`): add the
  page to the existing metadata line in both the question view and the
  end-of-round review.
- Print already shows the page in the answer key; unchanged.

### 2. Challenges

**Data model** — new table in `backend/src/db/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS question_challenges (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  attempt_id TEXT,
  exam_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('exam','practice')),
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','accepted','rejected')),
  reply TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE SET NULL,
  FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_status
  ON question_challenges(status, created_at);
CREATE INDEX IF NOT EXISTS idx_challenges_student
  ON question_challenges(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_challenges_question
  ON question_challenges(question_id);
```

Bump `SCHEMA_VERSION` to `"12"`. `migrate()` runs the `CREATE TABLE IF NOT
EXISTS`, so existing databases gain the table on the next cold start.

`attempt_id` is nullable: standalone-practice challenges have none.
Missed-question practice (`/practice/:attemptId`) and exam review both carry the
attempt id, so a challenge there is an exam challenge and dedupes against one
raised in review. `exam_id` is copied from the attempt so the inbox can still
name the exam after an attempt is deleted.
`ON DELETE SET NULL` keeps challenge history when an attempt or exam is removed.

**Endpoints** — new `backend/src/routes/challenges.ts`, mounted at
`/api/challenges` in `backend/src/app.ts`.

- `POST /api/challenges` — signed-in users.
  Body: `{ question_id, message, attempt_id? }`.
  - 400 if `question_id` or a non-empty `message` (max 2,000 chars) is missing.
  - 404 if the question does not exist.
  - If `attempt_id` is supplied: 404 if not found; 403 if it is not the caller's
    attempt; 400 if the attempt is still `in_progress`; 400 if the question is
    not part of that exam. `source = "exam"`, `exam_id = attempt.exam_id`.
  - Without `attempt_id`: `source = "practice"`, `attempt_id` and `exam_id`
    null.
  - 409 with the existing challenge when the same user already has an `open`
    challenge for that question and the same attempt (or practice, where
    `attempt_id IS NULL`).
  - Insert and return the challenge.
- `GET /api/challenges` — `teacher`/`admin` only.
  Optional query: `status` (`open` default, or `accepted`, `rejected`, `all`),
  `q` (matches student name, question prompt, or exam title).
  Returns challenges newest-first with student name, question prompt/options/
  answer/explanation/page/page_number, exam title, source, message, status,
  reply and dates.
- `GET /api/challenges/mine` — the caller's own challenges, newest-first, with
  the question prompt/page, exam title (when applicable), message, status and
  reply.
- `PUT /api/challenges/:id` — `teacher`/`admin` only.
  Body: `{ status: "accepted" | "rejected", reply?: string }`.
  404 if missing; 400 for an invalid status or reply over 2,000 chars. Only an
  `open` challenge can be resolved; 409 otherwise. Sets `reviewed_by`,
  `reviewed_at`. Does not touch the question or any score.

**Existing endpoints**

- Review endpoint: per question, include the current student's challenge for
  that question and attempt, if any (`{ id, status, message, reply }`). One
  extra query for the whole attempt.
- Practice endpoint: per question, include the caller's latest challenge for
  that question (any attempt), so a form that was already submitted does not
  look untouched.

**Frontend**

- New reusable `frontend/src/components/ChallengeBox.tsx`.
  Props: `questionId`, optional `attemptId`, `existing` challenge, optional
  `onSubmitted`.
  - Collapsed: a small flag icon + `Challenge` / `চ্যালেঞ্জ করুন` button.
  - Expanded: a `Textarea` for the reason, Submit and Cancel.
  - On success: replace the form with `চ্যালেঞ্জ জমা হয়েছে` and the status.
  - If `existing` is present: show the status (`open` / `accepted` /
    `rejected`) and the staff reply instead of the form. A resolved challenge
    may be opened again? No — resolved is final; no second form for now.
  - On 409: show the returned existing status instead of an error.
  - On failure: use the existing toast.

- `Results.tsx` review: render `ChallengeBox` under each question for
  students. Staff do not get the box.
- `Practice.tsx`: render it after the answer feedback for students, passing
  the attempt id (this screen is `/practice/:attemptId`), so it is an exam
  challenge and shares the review screen's dedupe.
- `StandalonePractice.tsx`: render it after the answer feedback and in the
  end-of-round review for students.
- New `frontend/src/pages/Challenges.tsx`, route `/challenges`, all roles.
  - Student view: title, optional status filter, list of own challenges with
    question prompt + page, source (exam title or practice), their message,
    status badge, date, and staff reply.
  - Staff view: title, status filter (Open/Accepted/Rejected/All), search box,
    and a card per challenge showing student, question prompt + page, options
    with the key highlighted, explanation, source/exam, message and date. An
    open card has a reply `Textarea` plus Accept and Reject buttons; on success
    toast and refresh.
  - Empty states: students without challenges; staff with no matches.
- Add `{ to: "/challenges", label: "Challenges", icon: MessageSquareWarning,
  roles: ["admin","teacher","student"] }` to `Shell.tsx` nav, after Results.
- Add the `/challenges` route in `App.tsx` inside `Private` with no role
  restriction.

### 3. Delete an attempt

**Backend**

- `DELETE /api/exams/attempts/:attemptId` with `requireRole("admin",
  "teacher")` in `backend/src/routes/exams.ts`.
  - 404 if the attempt does not exist.
  - 409 if the attempt is still `in_progress`. A paper being sat must not vanish
    mid-exam; in-progress attempts are also not on the leaderboard yet.
  - Delete the matching `results` row first, then the `exam_attempts` row.
  - `question_challenges.attempt_id` becomes `NULL` via the foreign key; the
    challenge itself remains.
  - Return `{ ok: true }`.

**Frontend**

- `Results.tsx` attempt row: for teachers/admins, add a trash icon button next
  to Review, only when the attempt is not `in_progress`.
  - `confirmDialog` with a danger tone: `Delete this attempt? The student's
    score and leaderboard entry for it will be removed.`
  - On confirm, call the endpoint, close the open detail if it was that
    attempt, show a success toast, reload the list.
- Students never see the button.

## Edge cases

- A question with no page: no page line at all.
- Address a page range (`42-43`) verbatim; do not reformat.
- Challenge on a question that has since been deleted: the challenge is deleted
  by the foreign key; no orphan UI.
- Same question challenged from exam review and from missed-question practice:
  both carry the same attempt id, so the open-challenge check reports the
  existing one instead of creating a second.
- Attempt deleted after a challenge: the challenge stays with source `exam` and
  its stored `exam_id`; the review link is gone but the inbox card still reads.
- Teacher resolves a challenge while the student is looking at the page: the
  student sees the new status on the next load; no live push.
- Double-submit: the server's open-challenge check returns 409, and the box
  shows the existing status.
- An exam containing the same question twice: the review endpoint's challenge
  lookup is per question id, so the same challenge appears on both rows. This is
  acceptable and matches the question identity.
- An attempt deleted while its review detail is open: close the detail and
  reload.

## Verification

- `cd backend && npm run typecheck`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run build`
- With the seeded demo data, manually check:
  1. Student review of a submitted exam shows `বইয়ের পৃষ্ঠা …` when the
     question has one, and no line when it does not.
  2. Standalone practice and missed-question practice show the same.
  3. Student can challenge from all three places; the form rejects blank
     reasons; a duplicate open challenge is reported, not duplicated.
  4. Student sees the challenge and reply on `/challenges`.
  5. Teacher/admin sees it in the inbox, can filter and search, and can
     accept/reject with a reply; the student's page then shows the result.
  6. Teacher/admin deletes a submitted/graded attempt from Results; it
     disappears, the leaderboard no longer counts it, and the student can no
     longer open that review. An `in_progress` row has no delete button, and a
     direct API call returns 409.
  7. Students never see the correct key while an attempt is in progress.

## Decisions already made

- Challenge shape: inbox page (approach 1).
- Resolution: reply + status only; no key rewrite, no recalculation.
- Attempt deletion: teachers and admins.
- Challenges are offered after feedback, not during an exam.
- Source page is shown verbatim, with `page` preferred over `page_number`.
