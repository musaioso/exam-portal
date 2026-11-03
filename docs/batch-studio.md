# Batch Studio

Batch Studio builds a large pool of unique, evidence-checked MCQs from scanned textbook pages. It is a teacher/admin tool. It never updates or deletes an existing question: generation only inserts new rows, and every new row carries its page, source file, and exact source quote.

## Before you start

- Page images, one book page per image, named with the printed page number. Example: `BGS conv 55.png`.
- A vision-capable AI provider and model configured in **AI Generate** (Google Gemini, or another provider that accepts images).
- If the backend uses a remote database (Turso), download a backup from `/api/backup` before the first run. Local SQLite databases are copied automatically to `backend/data/backups/` before a schema migration.

## Generate tab

1. Open **Batch Studio** in the sidebar.
2. Pick the subject and chapter.
3. Select the chapter's page images. The filename is the page anchor: `BGS conv 55.png` is page 55.
4. Set the question target and the maximum questions per page.
5. Pick a vision-capable provider and model. Leave **Allow a flagged vision fallback** off unless OCR cannot read a valid quote.
6. Click **Start audit**.

### Page audit

- A page whose visible printed number matches its filename is **match** and is ready.
- A page with no visible number (usually the chapter opener) is **unnumbered**. The app proposes a number from the next or previous numbered page and the filename. Confirm it once.
- A page whose printed number differs from its filename is **mismatch**. Choose **Use filename** or **Use printed** before generating.
- Generation is blocked for a page until it has a resolved number. This prevents a silent one-page shift.

### Run

- The run saves each page as it passes. A failed page does not stop the rest of the batch.
- **Pause** stops the loop; **Resume** continues from the next pending page.
- **Retry failed pages** puts failed pages back in the queue.
- The counters show generated, quote-passed, answer-passed, rejected, and saved.
- The provider status line shows the last page and the provider error, if any.
- Keep the tab open while the run is active. Closing the tab stops the browser loop; reopen the batch from **Recent batches** and click **Resume**. Completed pages are skipped.
- **Recent batches** lists the last runs so a closed or reloaded tab can reopen, resume, inspect evidence, or undo a batch.

### Target and top-up

- The **target is exact**: accepted questions are capped at the remaining target, so a page cannot overshoot it.
- **Max per page** is a cap, not a quota. The model may return fewer if the page does not support that many distinct facts.
- If the pages finish below the target, click **Generate remaining**. It revisits completed pages (up to 4 attempts each), passes the existing questions as an avoid list, and keeps generating.
- If the source is genuinely exhausted, the batch stops and shows the shortfall instead of inventing questions.

### Evidence gates

A question is saved only when:

1. It has exactly 4 unique options and the answer is copied from one option.
2. Its `source_quote` matches the text of the cited page image (OCR, or a flagged vision fallback when enabled).
3. Every number in the question/options/answer appears on that page.
4. A second verifier pass says the quote supports the answer and the question stem / correct answer use no outside term. Distractor options may be plausible alternatives not on the page.
5. Its normalized prompt is not already in the bank or earlier in the batch.

Rejected rows stay in the evidence table with a reason. They never enter the bank.

### Undo

**Undo batch** deletes only the questions created by that batch (`questions.batch_id = ...`). Existing questions are never selected.

## What counts as “from the book”

A question is valid only when the page supports it in one of two ways:

1. **Explicit** — the stem, answer, name, date, label, or term is stated on the
   page.
2. **One-step calculation** — the answer is a single arithmetic result from
   numbers the page states: sum, difference, half, double, or percentage. The
   generator must record the calculation (for example `80000 / 2 = 40000`) and
   the verifier checks that every input number is on the page and the arithmetic
   is correct.

A name, date, label, classification, or term is never accepted by calculation.
A range is accepted only when the page states that range or the range follows
directly from stated numbers. “The book says 80,000 from both East and West”
does not justify “40,000 from East” unless the page also says the split is half.

## Importing from Gemini Notebook / NotebookLM

Use the template at `frontend/public/notebooklm-import-template.json`
(also linked as **NotebookLM template** on the Question Bank page). The shape is:

```json
{
  "format": "notebooklm-mcq-v1",
  "subject_code": "BGS",
  "chapter_number": 1,
  "skip_duplicates": true,
  "questions": [
    {
      "prompt": "...",
      "options": ["...", "...", "...", "..."],
      "answer": "exact option text or A/B/C/D",
      "explanation": "...",
      "page_number": 12,
      "section": "...",
      "source_quote": "...",
      "derivation": "optional one-step calculation"
    }
  ]
}
```

The importer resolves the subject by `subject_code` (BGS, B1, B2, ICT, ...),
the chapter by `chapter_number` or `chapter_title`, maps an A/B/C/D answer to
the option text, stores `source_quote` and `section`, and appends a derivation to
the explanation. It requires exactly four unique options and an answer that
matches one of them.

`page_number` is optional for NotebookLM imports. After importing:

1. Create or reuse the chapter's page-image batch.
2. In **Correct existing**, set **Audit scope** to **Search whole chapter**.
3. Start the audit. Questions without a page number are ranked against the
   chapter's OCR text and the best pages are verified.
4. Review, then fix the page, fix the answer, replace from the page, or delete.

## What students see

Generated questions store:

- the page number,
- the visible section heading (when the page has one),
- the exact verified source quote.

In **Results** and **Practice**, a wrong or unanswered question shows the page, section, and quote so the student can find the exact sentence in the textbook. The section is stored only when it also appears in the page text; otherwise it is left blank. Questions created before this field was added may show page + quote only.

## Provider failures

Gemini Flash can return 503 “high demand”, 429 rate limits, or a timeout. The batch retries a page up to 3 times with backoff, then:

- rate-limit 429s are retried;
- quota/billing 429s, auth errors, and other terminal provider errors pause the batch immediately instead of looping;
- after 3 consecutive retryable page failures the batch pauses;
- a configured fallback model is tried after the primary's retry budget is exhausted, and the successful fallback is also used for verification.

The worst case is a shortfall in the target count. The batch reports it and never invents questions to fill the gap.

## Correct existing tab

This audits the existing bank against the same page images. It never deletes a question, and it never changes a question id.

1. Pick the subject and chapter.
2. Pick the **page-image batch** that holds that chapter's confirmed pages. If the list is empty, run a Generate batch for the chapter first.
3. Click **Start audit**. It processes the questions in batches of 10 and fills the proposal table.
4. Verdicts:
   - **ok** — the keyed answer is supported on the claimed page.
   - **wrong_page** — the supporting quote is on another page; the proposed page is shown.
   - **wrong_answer** — the verifier found a different option that the page supports.
   - **not_found** — no supporting quote was found.
   - **bad_options** — the row is not a valid 4-option MCQ.
   - **outside_book** — the verifier found a term that is not on the page.
5. Select proposals and click **Apply selected**. Each approved change updates the question in place by id and writes a before/after `question_revisions` row first.
6. The **Usage** column shows how many exams and attempts reference the question. A change does not rewrite historical attempts; it affects future papers.
7. **Reject selected** closes a proposal without changing the question.
8. **Undo run** restores every applied change from its `before_json` snapshot. The question ids stay the same.

Only `page_number`, `page`, `answer`, `explanation`, `source_quote`, and `source_file` are mutable through this tab. A proposed answer is accepted only when it is already one of the existing options; otherwise the proposal is `needs manual edit` and the teacher edits the row in the normal question form.

## Limits in v1

- PNG/JPEG page images only; PDF input stays in the existing AI Generate page.
- One page image per generation call.
- The batch runs in the local backend and the browser drives the step loop; a Vercel serverless function is not used for the long run.
- Vercel caps a single request body at about 4.5 MB. Page-image uploads and the long batch run therefore belong on the local backend; the hosted site will reject a large page set with **Request Entity too large**.
- Ollama (local) is supported. A 4B vision model on CPU is slower than a cloud Gemini Flash model; use `gemini-3.5-flash` for production-quality batches if local inference is too slow.
- Correction of existing questions is the **Correct existing** tab; it updates in place and keeps question ids.
