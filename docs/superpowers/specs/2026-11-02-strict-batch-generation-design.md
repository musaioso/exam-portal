# Strict Batch Generation — Design

Date: 2026-11-02
Status: Draft for review
Owner: Teacher/admin tooling (MCQ Studio)

## 1. Intent and why

The user needs a large pool of **unique** MCQs for BGS (and later other subjects) from scanned textbook pages. The current manual workflow is:

1. Prompt NotebookLM per chapter.
2. Copy the JSON out.
3. Upload it to MCQ Studio.

NotebookLM is used because it stays inside the uploaded sources. Plain Gemini chat previously produced questions from outside the book, which caused problems with students. Page numbers, chapter titles, and content must be exact.

The goal is one batch action per chapter (or a queue of chapters) that generates as many unique questions as the source supports, proves each question against the exact scanned page, stamps the page number from the source file, and saves the survivors to the bank.

## 2. Goals

- Generate up to a target count of unique MCQs per chapter from scanned page images or a PDF.
- Every saved question must carry a **verbatim source quote** that is verified on the claimed page image.
- Every saved question must carry the **page number derived from the source filename** (for example `BGS conv 55.png` → 55), never a page number written by the model.
- Every saved question must have exactly 4 options, an answer copied verbatim from the options, and a correct `answer_key`.
- Reject outside-book questions, wrong-page quotes, unsupported answers, duplicates, and malformed rows.
- Support the unnumbered chapter opener with a **propose-and-confirm** step.
- Show live progress, rejection reasons, and an evidence table.
- Save accepted questions automatically with a batch tag and one-click undo. Review-first mode is deferred to Phase 3.
- Resume a paused or interrupted batch without duplicating questions.
- Audit and correct existing questions **in place** with the same evidence gate, without changing question IDs or deleting rows.
- Leave the existing 2k+ question bank intact: additive migrations only, scoped writes, and a backup before migration.

## 3. Non-goals

- Automating NotebookLM itself. It has no public API; browser automation is out of scope.
- Generating multiple variants/versions of the same paper. The goal is one larger pool.
- Replacing the existing AI Generate page. Batch Studio is a separate tool that reuses its services.
- A full RAG/vector database in v1.
- OCR of a whole book or chapter up front.
- Running long batch jobs on Vercel serverless functions.
- Changing exam, practice, or print behaviour beyond displaying the stored page number.
- PDF input in v1. Batch Studio takes page images only (PNG/JPEG); the existing AI Generate page still handles PDFs.
- A review-first approval workflow in v1. It is designed for Phase 3.
- Auto-deleting existing questions, or rewriting historical exam attempts.
- Replacing an existing question row (delete + insert). Corrections update in place and keep the id.

## 4. Anti-goals (failure modes)

- A question saved without a verified quote.
- A page number inferred or written by the model.
- A silent page shift (all questions off by one page).
- Duplicate questions in the bank.
- Outside-book terms, classifications, or statistics appearing in a saved question.
- A batch that loses progress when the browser tab closes.
- A batch that keeps retrying forever when the source is exhausted.
- A destructive migration or a bulk update that touches questions outside the selected batch.
- Changing a question id that exams or attempts already reference.
- Losing the before/after snapshot for a correction.

## 5. Constraints

- Sources are scanned PNGs, usually named `BGS conv NN.png`, where NN is the printed book page.
- The chapter opener often has no visible printed page number.
- v1 accepts page images only (PNG/JPEG). PDFs are converted to page images, or handled by the existing AI Generate page.
- NotebookLM has no API; direct source-grounded generation uses the Gemini API with page images.
- Gemini accepts images and PDFs directly (PDF up to 50 MB / 1,000 pages), so no full-book OCR is required.
- The app stack: Express + SQLite/libSQL backend, React/Vite + Tailwind frontend.
- Existing AI services: `backend/src/services/ai/{chat,prompt,providers,models}.ts`.
- Existing import: `POST /api/questions/bulk-import` in `backend/src/routes/questions.ts`.
- Existing schema/migrations: `backend/src/db/migrate.ts`.
- Vercel functions have time limits and no persistent disk. Batch Studio is therefore a local/teacher tool; it may write to the same local SQLite or remote Turso database the backend is configured for.
- Concurrent edits use the existing auth roles: admin and teacher only.
- The live bank already contains 2k+ questions across many subjects and chapters. Migrations must be additive; no table rebuilds or column drops.
- A backup of the database is taken before the first migration and before a correction batch is applied.

## 6. Approaches considered

| Approach | Grounding | Automation | OCR | Verdict |
|---|---|---|---|---|
| A. NotebookLM + browser automation (extension/Playwright) | Strong, retrieval-bound | Fragile; UI/ToS risk | None | Rejected |
| B. NotebookLM generation + auto-upload helper | Strong | Prompting stays manual | None | Rejected for full automation |
| C. Direct scanned pages + Gemini API + evidence gate | Evidence-bound: quote must exist on the exact page | Fully batchable | Only cited pages / number corners | **Chosen** |
| D. Full RAG/embeddings over the textbook | Strong | Complex | Still needs OCR for scans | Future option, not v1 |

The chosen approach replaces NotebookLM’s retrieval boundary with an **evidence boundary**: the model may draft anything, but a question is saved only if its verbatim quote is found on the exact page image.

## 7. How the pipeline works

For each chapter:

1. **Upload / select source pages.**
   The teacher selects the chapter’s PNGs/JPEGs. The app reads each filename and extracts the page number. Example: `BGS conv 55.png` → 55. PDF input is not part of v1.

2. **Page audit (before generation).**
   - For pages with a visible printed number, OCR only the page-number corner (top/bottom ~12% crop, digits whitelist) and compare it with the filename.
   - If they match, the page is `match`.
   - If the page has no visible number (usually the chapter opener), propose the number from the nearest numbered neighbour:
     - next numbered page − 1, or
     - previous numbered page + 1, or
     - the filename.
   - If all agree, show one confirmation button. If they disagree, flag the page and require the teacher to choose or type the number. Generation is blocked for that page until confirmed.
   - Audit is per chapter, not per question.

3. **Generate one page at a time.**
   Each Gemini call receives exactly one page image and the instruction: use only this image; return questions with a verbatim `source_quote`; do not return a page number. The app stamps `page_number` and `source_file` after the call. One page per call is the strongest practical source boundary: the model cannot pull facts from another page or chapter.

4. **Deterministic validation.**
   - `type` is `mcq`; exactly 4 unique options; answer exactly matches one option.
   - `answer_key` matches the answer’s position (A = 1st, B = 2nd, C = 3rd, D = 4th).
   - Prompt is non-empty and contains no page reference or source attribution (“according to page…”, “on page…”, “according to Table/Figure”, “পাঠ্যবই অনুযায়ী”).
   - Marks = 1; difficulty is easy/medium/hard.

5. **Quote gate.**
   - Oracle order for the cited page: (a) PDF text layer, only when a text PDF was used (not v1); (b) Tesseract OCR of the page image, cached per page; (c) an optional vision transcript of the same page when `allowVisionFallback` is enabled.
   - Normalise text (case, whitespace, punctuation) and require the `source_quote` to match at or above a fuzzy threshold (for example 0.9).
   - An OCR/text-layer match is `verified`. A vision match is `vision-verified`, flagged in the evidence table. Default `allowVisionFallback = false`.
   - If neither oracle finds the quote, reject with `quote not found on page N`.
   - v1 checks only the cited page. It does not search other pages, so it never claims “found on page M”.

6. **Answer gate.**
   - A second LLM call receives the same page image plus the candidate question, answer, options, and quote.
   - It returns a per-item verdict: does the quote support the answer, and is the question answerable from this page alone?
   - The verifier must also mark INVALID if the question uses a term, classification, or statistic that is not present on the page.
   - Deterministic numeric check: every numeric token in the prompt/options/answer must appear in the page text. A missing number is a rejection reason.
   - Use a different model from the generator when configured; otherwise the same model at temperature 0 with a strict verifier prompt.
   - Reject invalid items with a reason.

7. **Duplicate gate.**
   - Normalise prompts (case/punctuation-insensitive) and check against the bank and the current batch.
   - Only new prompts proceed.

8. **Save.**
   - Accepted rows are inserted with `batch_id`, the resolved page number, `source_file`, and `source_quote`.
   - Auto-save saves immediately after all gates pass. Review-first approval is Phase 3.
   - A batch tag allows one-click undo.

9. **Repeat.**
   - Continue page by page until the target is reached, the chapter’s pages are exhausted, or the teacher pauses.
   - If the source is exhausted before the target, report `source exhausted`; never fabricate to fill the count.

## 8. Page numbers: stamped, not generated

- The source filename is the default anchor: `BGS conv 55.png` → 55.
- The app attaches the page number; the model’s output never contains a page number.
- The page audit cross-checks visible printed numbers and the neighbours.
- If the filename is wrong, the audit catches it before generation. If the visible number is missing, the opener is confirmed once.
- There is one **resolved page number** per page: the teacher-confirmed number when a correction was made, otherwise the filename number. The resolved number is what gets stamped on every saved question, and it is the value the success criteria refer to.
- A correction relaxes the filename invariant for that page only. The original filename is still stored for audit.
- The quote gate checks the quote against the exact page image.
- Stored per question: `page_number` (resolved), `source_file`, `source_quote`, `verification`, and `verification_method`.

## 8.1 Existing question correction

The same page images and evidence gate can audit existing questions. Correction is a separate mode, not a generation run.

For each selected question:

1. Resolve the claimed page (`page_number`, else `page`) and the chapter's page images.
2. Verify the answer against the claimed page: find the supporting sentence, check options/answer/answer_key, and check for outside-book numbers or terms.
3. If the answer is not supported on the claimed page, search the chapter's pages (nearest first, up to a configurable cap) for the supporting sentence and propose the correct page.
4. Produce a proposal: `ok`, `wrong_page`, `wrong_answer`, `not_found`, `bad_options`, or `outside_book`, with current values, proposed values, evidence quote, page, and confidence.
5. The teacher approves or rejects each proposal. Approved changes update the row **in place by id**; the id never changes. A `question_revisions` row stores the before/after snapshot for undo.
6. Answer changes are only proposed when the correct answer is already one of the existing options. If the options themselves are wrong, the proposal is `needs manual edit`; the mode does not invent a new option set.
7. No auto-delete. Questions that cannot be supported are flagged, not removed. The teacher can edit or delete them through the existing question UI.
8. The UI warns when a question is used by exams or attempts; changing its answer does not rewrite historical attempts.

Correction undo restores the `before_json` snapshot for every revision in the batch, in reverse order. It never touches questions outside the batch.

## 8.2 Non-destructive data policy

- Migrations are additive only: `ALTER TABLE ... ADD COLUMN` with null/default values. No table rebuild, column drop, or data rewrite.
- Before the first migration, copy the local SQLite file (or export a JSON backup for a remote DB) and record the question count per subject.
- Generation writes only rows created by the batch. It never updates or deletes an existing question.
- Correction updates use `WHERE id = ?` for explicitly approved ids, inside a transaction, and write a revision snapshot first.
- Batch undo deletes only `questions.batch_id = ?` rows created by that batch. Existing rows have `batch_id = NULL` and are never selected.
- Tests run against a copy of the real 2k+ question database and assert row counts and ids are unchanged by migration and generation.

## 9. Batch orchestration

- **One batch = one chapter.** The UI can create several batches from a multi-chapter selection and run them sequentially.
- The frontend drives the loop by calling `POST /api/batches/:id/step`. Each call processes the next pending page (generate + validate + verify + save) and returns progress. This avoids long-running serverless requests and makes the UI’s live progress truthful.
- If the tab closes, the batch becomes `paused`; reopening resumes from the next pending page.
- The step endpoint atomically claims the next `pending` page: set `status='running'`, `attempts = attempts + 1`, `lease_until = now + 120s`. It processes the page, inserts accepted questions, and sets `status='done'` in one transaction.
- If the browser loses the response after a page is saved, the page is already `done`, so resume skips it.
- `batch_items` has a uniqueness constraint on `(batch_id, page_number, prompt_hash)` for identical retries. The page-level claim is the primary resume guard.
- If the process dies mid-page, the lease expires and the page can be claimed again. The duplicate gate re-runs before insert, so near-duplicates are re-checked.
- A failed page is retried up to 3 times, then marked `failed` and the batch continues.
- A future headless CLI can call the same step endpoint; it is not part of v1.

## 10. Data model (new tables and columns)

New tables:

- `batch_runs`
  - `id`, `subject_id`, `chapter_id`, `target_count`, `max_per_page`,
    `provider`, `model`, `fallback_models` (JSON list), `save_mode` (`auto` | `review`),
    `allow_vision_fallback`, `status`
    (`draft` | `auditing` | `ready` | `running` | `paused` | `done` | `failed`),
    `generated`, `quote_ok`, `answer_ok`, `rejected`, `saved`, `consecutive_failures`,
    `created_by`, `created_at`, `completed_at`.

- `batch_pages`
  - `id`, `batch_id`, `page_number` (from filename), `resolved_page_number`
    (filename, or the teacher-confirmed correction), `source_file`,
    `printed_number` (OCR), `audit_status` (`match` | `mismatch` | `unnumbered` | `confirmed`),
    `status` (`pending` | `running` | `done` | `failed`), `attempts`, `lease_until`,
    `last_error`, `image_path` (local cache), `image_sha`, `created_at`.

- `batch_items`
  - `id`, `batch_id`, `page_number`, `status` (`accepted` | `rejected`),
    `reason`, `question_json`, `source_quote`, `source_file`,
    `verifier_json`, `verification_method` (`ocr` | `text-layer` | `vision`),
    `prompt_hash`, `created_at`.

- `correction_runs`
  - `id`, `subject_id`, `chapter_id`, `source_batch_id` (nullable; the page-image
    set), `status` (`draft` | `auditing` | `review` | `applying` | `done` | `failed`),
    `checked`, `ok`, `wrong_page`, `wrong_answer`, `not_found`, `applied`,
    `created_by`, `created_at`, `completed_at`.

- `correction_items`
  - `id`, `run_id`, `question_id`, `verdict`, `current_json`, `proposed_json`,
    `evidence_json`, `status` (`proposed` | `applied` | `rejected` | `skipped`),
    `created_at`.

- `question_revisions`
  - `id`, `question_id`, `run_id`, `before_json`, `after_json`,
    `reason`, `created_by`, `created_at`, `undone_at`.

Existing table changes:

- `questions`: add `batch_id` (nullable), `source_quote` (text, nullable),
  `source_file` (text, nullable), `verification` (text/JSON, nullable),
  `verification_method` (text, nullable).
- `questions.page_number` stores the resolved page number.
- `questions.batch_id` enables batch undo and audit.
- Existing rows remain valid with null evidence.

Source images are cached under a local batch folder (for example
`backend/data/batches/<batch_id>/`) for the duration of the batch. They are not
stored as blobs in the database in v1. This keeps the DB small and is acceptable
because Batch Studio is a local tool. A future object-storage option can remove
the local-only constraint.

## 11. API surface

All routes require admin/teacher.

- `POST /api/batches` — create a batch for one subject + chapter (`allowVisionFallback`, `targetCount`, `maxPerPage`).
- `POST /api/batches/:id/pages` — upload page images (multipart PNG/JPEG); parse filenames.
- `POST /api/batches/:id/audit` — run the page-number audit; return page statuses.
- `POST /api/batches/:id/confirm-page` — confirm or correct an unnumbered opener; sets `resolved_page_number`.
- `POST /api/batches/:id/step` — atomically claim and process the next pending page (generate + gates + save).
- `POST /api/batches/:id/pause` / `resume`.
- `GET /api/batches/:id` — status, counters, pages, items (paginated).
- `GET /api/batches` — recent batches.
- `DELETE /api/batches/:id` — undo: delete the batch’s questions and batch rows.

Correction endpoints (admin/teacher):

- `POST /api/corrections` — create a correction run for a subject/chapter or explicit question ids; reference a page-image batch or upload a page set.
- `POST /api/corrections/:id/step` — audit the next batch of existing questions; write proposals.
- `GET /api/corrections/:id` — proposals with current/proposed values and evidence.
- `POST /api/corrections/:id/apply` — apply approved item ids in a transaction; write `question_revisions` first.
- `POST /api/corrections/:id/reject` — mark proposals rejected.
- `POST /api/corrections/:id/undo` — restore the `before_json` snapshots for the run.

Reuse:
- `backend/src/services/ai/chat.ts` for provider calls.
- `backend/src/services/ai/providers.ts` for Gemini/other provider config.
- `backend/src/routes/questions.ts` validation patterns and insert logic; extend the insert path to write the batch evidence columns atomically.
- `backend/src/routes/documents.ts` for image upload/OCR helpers where useful.

## 12. UI (Batch Studio)

New route `/batch`, visible to admin/teacher.

1. **Setup**
   - Subject, chapter, source page images, target count, max per page, retries.
   - Provider/model, auto-save, allow-vision-fallback toggle (default off).
   - “Start audit” button.

2. **Page audit**
   - Contact sheet of pages: thumbnail, filename, printed number, resolved number, status.
   - Green check for matches; amber for unnumbered; red for mismatch.
   - One confirmation button for the opener; mismatch requires a choice.

3. **Run**
   - Per-chapter progress, current page, counters:
     generated, quote-passed, answer-passed, rejected, saved.
   - Provider status banner: model, attempt n/3, “waiting 8 s”, or the last error.
   - Failed pages with a **Retry failed pages** button; the batch pauses after 3 consecutive failed pages.
   - Rejected list with reasons and actions (retry, edit, discard).
   - Pause/resume.

4. **Evidence**
   - Table: question, answer, page, source file, source quote, verdict.
   - Filters for accepted/rejected.
   - “Undo batch” danger action.

5. **History**
   - Recent batches with counts and undo.

6. **Correct existing**
   - Select subject/chapter and the page-image set.
   - Run the audit; table of existing questions with verdict, current values, proposed values, and evidence.
   - Filters for `ok`, `wrong_page`, `wrong_answer`, `not_found`, `bad_options`, `outside_book`.
   - Apply selected, reject, and undo corrections.
   - Warn when a question is used by exams/attempts, and never change its id.

Batch Studio has two tabs: **Generate** and **Correct existing**.

Reuse the existing `glass` theme, `Field`, `Select`, `Button`, and toast/dialog patterns from `frontend/src/pages/Generate.tsx` and `frontend/src/components/ui.tsx`.

## 13. Error handling and resume

- Network/model error: retry the page up to 3 times with backoff.
- Page-level failure: record the reason, continue to the next page.
- Tab close: batch status `paused`; resume from the first page that is not `done`.
- Duplicate retry: the page claim/lease prevents re-processing a `done` page; the `(batch_id, page_number, prompt_hash)` constraint blocks identical re-inserts; the duplicate gate re-runs on any retry.
- Audit mismatch: block generation for that chapter until resolved; the resolved number is what gets stamped.
- Source exhausted: report the shortfall; do not invent.
- Undo: delete questions where `batch_id = ?`, then the batch rows.

### 13.1 Provider failure policy (Gemini Flash)

Gemini Flash is expected to fail transiently: 503 “high demand”, 429 rate limits, dropped connections, timeouts, and occasional invalid/truncated JSON. These are normal events, not batch-ending failures. The batch isolates them to one page.

Per page:

- Attempt up to **3 times** with exponential backoff and jitter: roughly 2 s, 8 s, 30 s.
- **Retryable:** 429 rate limit, 500/502/503/504, network error, timeout, invalid or truncated JSON.
- **Non-retryable:** 400 invalid request, 401/403 auth or model-access errors, 402 credit, and 429 quota/billing. Pause the batch and show the actionable message instead of retrying forever.
- Respect `Retry-After` when the provider sends it.
- After 3 failed attempts: mark the page `failed`, store the error, and continue to the next page. Questions accepted from other pages are already saved.
- **Circuit breaker:** after 3 consecutive failed pages, pause the batch and tell the user; resume later. This avoids burning quota.
- **Concurrency 1** by default, with at least 1.5 s between calls and a configurable per-minute cap (default 20).
- **Fallback chain:** primary model → one or more fallback models from the same or another configured provider. Try the fallback only after the primary’s retry budget is exhausted, not on every transient error.
- **Smaller output on retry:** first ask for at most 5 questions per page; if JSON is truncated or invalid, retry with at most 3.
- The existing `chat.ts` already retries 5xx twice; the batch layer adds page-level retries, 429 handling, fallback, and the circuit breaker.
- The Run screen shows the attempt count, “waiting 8 s”, the provider error, failed pages, and a **Retry failed pages** button.
- A shortfall caused by failures is reported honestly; the batch never invents questions to hit the target.

## 14. Security and privacy

- Batch endpoints require admin/teacher.
- Gemini API keys remain server-side.
- Source images stay in a local cache; no public URLs.
- The evidence table exposes only what the teacher uploaded.
- Copyrighted textbook images are not published by the app.

## 15. Testing

Backend unit tests:
- Filename → page number parsing.
- Opener inference from next/previous numbered pages.
- Printed-number OCR parsing (digits whitelist, crop).
- Text normalisation and fuzzy quote matching.
- Quote oracle order: OCR → optional vision fallback; vision-disabled rejects.
- Numeric token extraction and the outside-number check.
- Deterministic question validation (options, answer, answer_key, banned phrases).
- Duplicate normalisation.
- Page stamping: the model cannot change `page_number`; the resolved number wins over the filename.

Backend integration tests (temp DB + fake AI provider):
- Audit: match, mismatch, unnumbered opener, confirmation.
- Step: generate → quote gate → answer gate → save.
- Rejection: quote not found on the cited page; outside-book term; missing numeric token; bad answer_key.
- Vision fallback: disabled → reject; enabled → saved and flagged `vision-verified`.
- Resolved page: a mismatch corrected to 56 stamps 56 on saved questions, not the filename’s 55.
- Page claim: a completed page is skipped on resume; a lost response does not duplicate.
- Provider 503: fails twice, succeeds on the third attempt; counts are correct.
- Provider 429 rate limit: backs off and retries; quota 429 pauses without a retry loop.
- Provider timeout: page is marked failed, accepted pages remain saved, batch continues.
- Fallback: primary model exhausts its retries, the fallback model is used, evidence records the model.
- Circuit breaker: 3 consecutive failed pages pause the batch.
- Resume: stop after page 2, resume, no duplicates.
- Undo: removes the batch’s questions only.
- Re-run: adds only new prompts.

Integrity and correction tests (run against a copy of the real 2k+ question DB):
- Migration is additive: question count per subject and all question ids are unchanged.
- Generation creates only new rows; no existing row is updated or deleted.
- Correction updates only explicitly selected ids; ids never change.
- Revision snapshot is written before an update; undo restores the exact before values.
- Correction never deletes a question; a question referenced by an exam/attempt still resolves.
- Scoping: a correction run for one chapter does not touch other chapters.
- Wrong-page search proposes the correct page but does not auto-apply.
- An answer change is proposed only when the correct answer is already one of the options.
- A backup exists before migration and before applying a correction batch.

Frontend:
- Manual happy-path check in Batch Studio.
- If a test setup exists by implementation time, add component tests for the audit sheet and evidence table.

Golden fixture:
- A synthetic 3-page chapter with known text, fake AI responses, and expected saved/rejected counts.

## 16. Success criteria

- A 22-page chapter can produce 50 unique questions in one batch.
- 100% of saved questions have a quote verified on the claimed page image (`verified`; or `vision-verified` only when the toggle was enabled).
- 0 saved questions have a page number different from the resolved page number (filename, or teacher-confirmed correction).
- 0 duplicate prompts against the bank or within the batch.
- The opener is confirmed in one click.
- A deliberately misnamed page is caught before generation.
- A hallucinated quote is rejected.
- A question using an outside-book number or term is rejected.
- One-click undo removes the whole batch.
- Re-running the same chapter adds only new questions.
- Migration and generation leave the existing 2k+ questions unchanged (same count, same ids).
- A correction updates the question in place, keeps its id, and writes a revision snapshot.
- Undo restores the exact before values of every corrected question.
- A question used by an exam or attempt still resolves after a correction.

## 17. Phases

1. **Backend core:** additive migrations + backup, batch tables, page upload/audit, one-page generation, quote/answer gates, save with evidence, undo. Testable via API against a copy of the real DB.
2. **Batch Studio — Generate:** setup, audit sheet, run progress, evidence table, history; create several chapter batches and run them sequentially.
3. **Correction mode:** audit existing questions against the page images, proposals, apply-in-place with revisions, undo; Generate/Correct tabs in Batch Studio.
4. **Polish:** review-first mode, pause/resume refinements, report export.
5. **Future:** headless CLI for long runs; object storage for serverless batches; optional RAG for very large sources.

## 18. Calls made in this draft (check these)

- **Layout:** Batch Studio page (option A), not the command bar or CLI.
- **Save mode:** auto-save after all gates, with one-click undo; review-first is deferred to Phase 3.
- **Execution:** local backend + browser-driven step loop; no Vercel background worker in v1.
- **Input:** page images only in v1; PDFs are converted or handled by the existing Generate page.
- **Generation boundary:** one page image per Gemini call; no whole-chapter prompt.
- **Verification:** OCR/text-layer quote match first; optional flagged vision fallback (default off); one LLM answer-verifier call per page, batched over that page’s candidates; deterministic numeric check.
- **Page source:** filename is the default anchor; the opener is proposed from neighbours and confirmed once; the resolved number (filename or confirmed correction) is stamped on questions.
- **Cross-page search:** none in v1; the gate checks only the cited page.
- **Resume:** the step endpoint claims a page with a lease; completed pages are skipped; duplicate gates re-run on retries.
- **Provider failures:** 3 page-level retries with backoff; 429 rate-limit vs quota distinction; circuit breaker after 3 consecutive failed pages; configurable fallback model chain; failed pages retryable without losing accepted work.
- **Existing data:** additive migrations only, a backup before migration, generation inserts only new rows, and tests against a copy of the 2k+ DB.
- **Correction mode:** a separate run that proposes fixes, applies only selected ids in place, keeps ids, writes revision snapshots, and supports undo. No deletes.
- **Evidence storage:** `questions.batch_id`, `source_quote`, `source_file`, `verification`, `verification_method`; source images in a local batch cache.
