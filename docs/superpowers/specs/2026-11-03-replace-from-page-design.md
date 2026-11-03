# Replace from page — design

Date: 2026-11-03
Status: approved approach, implementation in progress

## Intent

The existing bank contains questions that are not fully supported by the
textbook. The BGS Chapter 1 pilot (100 questions, 17 page images) found:

- 57 fully verified
- 10 with the right fact on a different page
- 3 whose answer contradicts the book
- 20 outside the book
- 10 not found on the cited page

Most of the 30 outside/not-found rows are not wholly invented. The answer is
often on the page, but the stem adds an unsupported detail: an invented date
("15 May 1954"), a term the book does not use ("Magna Carta of Bengalis"), or a
number the book rounds ("3000" vs "thousands"). Some are genuinely outside the
book ("Lucknow", "188 countries", "Pahela Baishakh").

The user chose **replace** for the outside/not-found rows. Page and answer
errors are fixed in place instead of replacing the question.

## Outcome

A teacher can open one chapter, run the audit, select the flagged rows, click
**Replace from page**, inspect the proposed replacement, and apply it. The
question keeps its id and exam references, and **Undo** restores the old
content.

## Action matrix

| Verdict | Action |
|---|---|
| `ok` | none |
| `wrong_page` | update the page (and section/quote when available) |
| `wrong_answer` | update the answer (must be one of the existing options) |
| `outside_book` | generate a new grounded question from the source page |
| `not_found` | generate a new grounded question from the source page |
| `bad_options` | generate a new grounded question from the source page |
| `provider_error` | retry; never stored as a question verdict |

## Source page

For a replacement, choose the page in this order:

1. a `wrong_page` proposal, when present;
2. the question's claimed `page_number`, when that page is in the source batch;
3. the best matching chapter page from OCR text search (answer phrase, numbers,
   and prompt terms);
4. if no page can be anchored, fail the item with `replace_failed` and a reason.

The replacement is generated from the page image, so it is grounded even when
the original question claimed the wrong page.

## Generation and gates

Reuse the strict batch generator:

- one question per attempt (`generatePage`, maxQuestions = 1);
- pass existing chapter prompts as the avoid list;
- keep the original difficulty and marks;
- verify with `verifyCandidates`:
  - exactly four unique options;
  - answer copied from one option;
  - `sourceQuote` is on the page (OCR coverage ≥ 0.9);
  - every number in the stem and answer appears on the page;
  - stem and answer contain no term absent from the page (vision verifier);
  - distractors may be absent from the page.
- retry up to 3 candidates across up to 2 candidate pages;
- if nothing passes, store `replace_failed` with the rejection reason.

Provider errors are retried with backoff and are **not** turned into
`not_found`. A run stops with a clear error if the provider stays unavailable.

## Data model

No migration.

`correction_items.proposed_json` gains the full replacement:

```json
{
  "prompt": "...",
  "options": ["...", "...", "...", "..."],
  "answer": "...",
  "explanation": "...",
  "page": "9",
  "page_number": 9,
  "section": "...",
  "source_quote": "...",
  "difficulty": "medium"
}
```

The existing `question_revisions` table records before/after, so Undo already
works.

## API

`POST /api/corrections/:id/replace`

```json
{ "item_ids": ["..."], "max_pages": 2 }
```

Response:

```json
{ "replaced": 3, "failed": 1, "items": [ ... ] }
```

The existing apply, reject and undo endpoints are unchanged.

## UI

In **Batch Studio → Correct existing**:

- a **Replace from page** button for the selected flagged rows;
- the Proposed column shows the new prompt, answer, page and quote;
- Apply selected keeps the existing confirmation/undo flow;
- replacement failures show the verifier reason instead of a silent no-op.

## Non-goals

- deleting questions;
- changing question ids;
- auditing subjects without page images (Banan, until its images are located);
- writing directly to the live Turso database in this iteration.

## Live rollout

The local audit uses a copy of the bank. After the chapter is reviewed:

1. export the applied replacements as a patch JSON;
2. import the patch on the live site after deploy;
3. re-run the same verification on import.

The patch import is a separate, later step. The live bank is not touched until
the user approves the local result.

## Risks

- **Model recall.** The free-tier `gemini-3.5-flash-lite` model is strict and
  sometimes misses a fact that is on the page. Replacements are generated and
  verified by the same model, so the preview must be reviewed before apply.
- **OCR noise.** Quote matching uses OCR text. A clear quote can fail the OCR
  gate; the vision verifier is the fallback, and a failure is reported, not
  hidden.
- **Duplicates.** The avoid list covers existing chapter prompts; the unique
  prompt hash in `batch_items` is not reused for corrections.
- **Long runs.** Replacement is one generation plus one verification per item;
  a subject-wide run is a background job, not a request.

## Testing

- unit: replacement validation, apply/undo of prompt/options/section,
  `correct === answer` is not a change, provider errors are not verdicts;
- integration: fake generator + verifier, API replace route;
- real: BGS Chapter 1, generate replacements for the 30 outside/not-found rows,
  inspect them, apply a sample, undo, re-apply;
- frontend typecheck and build.
