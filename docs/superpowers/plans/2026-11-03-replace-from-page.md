# Replace from page — implementation plan

Date: 2026-11-03
Design: `docs/superpowers/specs/2026-11-03-replace-from-page-design.md`

## 1. Make audit verdicts honest

- In `auditQuestion`, when the verifier returns a `correctAnswer` equal to the
  keyed answer, return `not_found` (or `ok` if the quote supports it), never
  `wrong_answer`. Add a unit test.
- In `runCorrectionStep`, retry provider calls with backoff. On a persistent
  provider error, stop the step with a clear error and leave the item pending;
  do not store `not_found`.
- Keep `correction_runs` counts unchanged.

Tests: `backend/test/corrections-audit.test.ts`.

## 2. Replacement service

Add `backend/src/services/batch/replace.ts`:

```ts
replaceItems(runId, itemIds, { maxPages = 2, candidatesPerPage = 3 })
```

Steps per item:

1. load the question, source batch and pages;
2. choose the source page (wrong-page proposal → claimed page → text search);
3. call `generatePage` with `maxQuestions: 1` and the chapter avoid list;
4. call `verifyCandidates` with the page text and image;
5. on success, write the full replacement into `proposed_json`;
6. on failure, write `replace_failed` and the reason.

Return `{ replaced, failed, items }`.

Tests: `backend/test/replace.test.ts` with a fake `generatePage`/`verify` and
one real-shaped page.

## 3. Apply replacements in place

In `applyCorrections`:

- extend `MUTABLE_FIELDS` with `prompt`, `options`, `difficulty`, `section`;
- stringify `options` when writing;
- validate four unique options and that the answer is one of them;
- validate the page number is an integer ≥ 1;
- keep the existing revision and undo path.

Tests: `backend/test/corrections-apply.test.ts` and `batches-undo.test.ts`.

## 4. API

Add `POST /api/corrections/:id/replace` in
`backend/src/routes/corrections.ts`, admin/teacher only. Validate `item_ids`
with zod. Return `{ replaced, failed, items }`.

Tests: `backend/test/corrections-replace-api.test.ts`.

## 5. UI

In `frontend/src/components/batch/CorrectionPanel.tsx`:

- add `replaceCorrections` to `frontend/src/lib/batch.ts`;
- add a **Replace from page** button for selected `outside_book` / `not_found`
  rows;
- show the proposed prompt, answer, page and quote;
- show `replace_failed` reasons;
- keep Apply selected and Undo run.

Run frontend typecheck and build.

## 6. Real test on BGS Chapter 1

1. Start the test backend against `backend/data/mcq-audit.db`.
2. Load correction run `e98d867e-1179-4ac2-aa05-bb597706f992`.
3. Select the 30 outside/not-found rows.
4. Generate replacements.
5. Inspect the before/after list.
6. Apply a sample, verify the question rows and revisions, undo, re-apply.
7. Apply the rest only after the user approves the sample.

## 7. Subject-wide runner (next)

After Chapter 1 is accepted:

- add a background job that walks every chapter in a subject;
- create/reuse the page-image batch from the local folder map;
- audit, then generate replacements for flagged rows;
- expose progress and a single review queue.

## 8. Live rollout (after local approval)

- export applied replacements as a patch JSON;
- add an import endpoint that validates question ids and before-hashes;
- import on the live site after deploy.
