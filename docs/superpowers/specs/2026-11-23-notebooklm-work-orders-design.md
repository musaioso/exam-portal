# NotebookLM Work Orders — Design

Date: 2026-11-23
Status: Draft for review
Owner: Teacher/admin tooling (MCQ Studio)

## 1. Intent and why

The teacher generates questions in Google NotebookLM from chapter PNGs and
imports them into MCQ Studio. NotebookLM has no memory between chats and no
idea what the bank already holds, so the teacher has become the memory:

- Hours later the chat context is gone; the teacher retypes the whole
  instruction from scratch.
- A second session re-asks for questions and gets back ones already in the
  bank, reworded just enough to defeat exact-duplicate checks.
- Every new question format means re-explaining the format again, per chapter.
- Exported files land unnamed, with no record of which chapter or run they
  belong to.
- Batch Studio is too slow and too unreliable on these sources to replace the
  notebook, even though the site is where the questions must end up.

The product principle for this change: **the bank is the memory; NotebookLM is
a stateless worker.** The site issues a work order containing the format, the
chapter, the target count and the list of what already exists, and files the
reply when it comes back. A fresh chat per run becomes cheap instead of costly.

This builds on decisions already in the repo:

- `docs/prompts/cq-generator*.txt` define a creative question as one উদ্দীপক
  plus parts (ক 1, খ 2, গ 3, ঘ 4 = 10 marks), stored as four `long` rows.
- `questions.type` is `CHECK (type IN ('mcq','short','long'))`.
- `POST /api/questions/bulk-import` and the strict `notebooklm-mcq-v1` badge.
- Batch Studio (`frontend/src/pages/Batch.tsx`) tabs: Generate, Correct.

## 2. Goals

- One saved **job** per subject+chapter that holds the exam label, the question
  pattern, per-kind targets, the exact work order text, and a run history.
- Reopening the app after any gap answers "where was I?" without the teacher
  reconstructing anything.
- A **work order** built by the site: correct class/exam label, chapter
  identity, format contract, remaining count, and an avoid list drawn from the
  bank.
- A **paste reply** path: no file is written to disk; fences, citation markers
  and stray prose are cleaned before parsing.
- Support three things in one pipe: MCQ, short questions, and passages
  (one stem with several parts), including the two SSC 2027 patterns below.
- Passages are expanded by the server into part rows sharing a group id, so
  the model never has to repeat a stem four times.
- Duplicate control at both levels: prompt text and passage stem, including
  passages already in the bank from before this change.
- Patterns are editable in the UI, so a new format never needs code or a
  retyped prompt.
- Per-run undo that keeps the run record, additive migrations only, existing
  rows untouched.
- Every work order that was copied is stored, so an old run can be resumed
  exactly.

## 3. Non-goals

- Driving NotebookLM automatically. It has no public API.
- Replacing Batch Studio's generation or its evidence gates.
- Changing how exams, printing, practice or results render grouped rows
  (chunk 3, below). This change only stores the passage fields.
- Changing `questions.type` or rebuilding the table.
- Adding an AI provider call on the server for this path.
- A second paste box inside Question Bank. File import there stays as-is.
- Editing or deleting questions outside the run being undone.
- Per-student question variants, difficulty balancing or auto-marking of
  written answers.

## 4. Anti-goals (failure modes)

- A run that imports rows with no record of which job or run created them.
- The same passage re-imported under a reworded stem.
- The teacher having to remember or retype a format.
- A work order that silently omits the avoid list and produces duplicates.
- A silent page shift or a page number the model invented and nothing later
  checks.
- A partial ক–ঘ group imported because only one part collided.
- A grouped question whose parts drift apart in the bank.
- Losing the run history when a job is edited.
- A migration that rewrites existing questions.

## 5. Constraints

- NotebookLM reply limits: ask for small batches (default 20 MCQs or 6
  passages per message) and send "continue".
- NotebookLM output often arrives wrapped in ``` fences with `[1]` citation
  markers and a sentence of prose. All three must be stripped before parse.
- `notebooklm-mcq-v1` refuses anything but exactly four unique options and
  `type !== 'mcq'` throws. It cannot carry short questions or passages.
- `bulk-import` caps a file at 500 question rows.
- `chapters.part` accepts only `oddhay | poricched | godyo | podyo`. উপন্যাস and
  নাটক cannot be represented there, so the Bangla pattern is selected by
  chapter title, not by `part`.
- Frontend theme rules in `AGENTS.md`: shared `ui.tsx` controls, colours from
  `theme.css`, `npm run theme:check` before finishing.
- SQLite/libSQL; migrations are additive via `ensureColumn`; `SCHEMA_VERSION`
  must be bumped.
- Local backend runs the writes; no long job on a Vercel function.

## 6. Domain facts for SSC 2027 (English Version)

| Question kind | Marks | Notes |
|---|---|---|
| MCQ | 1 | Four unique options, one verbatim answer. |
| Short | 2 | Default for every subject. Standalone, no stem. |
| Passage / CQ | 1+2+3+4 = 10 | One উদ্দীপক, four parts ক খ গ ঘ. |
| Bangla 1st — উপন্যাস, নাটক | 3 + 7 = 10 | One উদ্দীপক, one 3-mark short and one 7-mark long part. **No MCQ, no four-part CQ.** |

The exam label is `SSC 2027` (class 9–10 book). The existing CQ prompt files say
"Class 8" and are stale for this cohort.

The full pattern matrix for the remaining subject/part combinations is not yet
confirmed by the teacher. Patterns are stored as editable records with a small
editor (§8.5), so the matrix is filled in the UI rather than in code. Seed only
the rows known now.

CQ rows already in the bank (those made with the `cq-generator` prompts) are four
`long` rows whose prompts begin `উদ্দীপক: <stem> (<part>) <question>` and carry
no passage columns. That legacy shape is read, never rewritten (see §8.2 and
§8.3).

## 7. Approaches considered

**A. Copy-prompt button + paste box only.** Smallest possible change: a button
that builds a prompt with the avoid list, and a paste box that imports. Kills
duplicates and files. It does not answer "where was I", so the teacher still
reconstructs the chapter, the count and the format each session.

**B. Saved work orders per chapter, built from A's pieces.** Adds a job row
that owns the format, targets, avoid list and run history. Reopening is one
click. More work than A: a table, a tab, a prompt builder, a run log. This is
the chosen approach.

**C. Let the site generate everything.** Removes the notebook, but Batch Studio
is already known to be slower and weaker on these PNG sources, and its
evidence gate would still have to audit any notebook output. Rejected: it
trades a known-good reader for a known-weak one.

## 8. Design

### 8.1 Data model (additive)

New tables:

```
question_patterns
  id, name, subject_id NULL (NULL = any subject),
  chapter_match TEXT NULL,      -- regex on chapter title, e.g. 'উপন্যাস|নাটক'
  parts TEXT NOT NULL,          -- JSON [{kind:'mcq',marks:1} |
                                --       {kind:'passage',parts:[1,2,3,4]} |
                                --       {kind:'short',marks:3} ...]
  is_default INTEGER, created_by, created_at, updated_at

generation_jobs
  id, subject_id, chapter_id, pattern_id,
  exam_label TEXT,              -- 'SSC 2027'
  targets TEXT,                 -- JSON {"mcq":40,"short":15,"passage":12}
  status TEXT,                  -- 'active' | 'done' | 'paused'
  notes TEXT, created_by, created_at, updated_at

generation_runs
  id, job_id, kind,             -- 'mcq' | 'short' | 'passage'
  requested INTEGER,            -- in units of `kind`
  prompt_text TEXT,             -- the exact work order that was copied
  imported INTEGER DEFAULT 0,   -- units accepted (a passage counts once)
  imported_rows INTEGER DEFAULT 0, -- question rows actually inserted
  skipped INTEGER DEFAULT 0, failed INTEGER DEFAULT 0,
  undone_at INTEGER,            -- NULL until the run is undone
  created_by, created_at
```

**Counters are in units, not rows.** For `kind='passage'`, one requested unit is
one stem, which becomes 2 or 4 rows. `imported_rows` carries the row count for
the run detail. Progress per job is computed from the bank: `mcq` rows,
standalone `short` rows, and `COUNT(DISTINCT passage_group)`, where a `short`
row counts as standalone only when `passage_group IS NULL`. A 3-mark short that
is part of a Bangla passage therefore never advances the standalone short
target.

Additive columns on `questions`:

```
job_id TEXT, generation_run_id TEXT,
passage_group TEXT,      -- shared id across the parts of one stem
passage_stem TEXT,       -- the stem, stored once per part row
passage_part TEXT,       -- 'ক' | 'খ' | 'গ' | 'ঘ' | '1' | '2'
passage_index INTEGER    -- order within the group
```

Indexes: `questions(job_id)`, `questions(generation_run_id)`,
`questions(passage_group)`.

`type` is unchanged. A four-part CQ stays four `long` rows, matching the
existing prompt convention and keeping the type CHECK intact. A Bangla novel
passage is one `short` (3) plus one `long` (7) row in the same group.

### 8.2 Work order builder

`POST /api/jobs/:id/work-order { kind, count }` creates a `generation_runs` row,
stores `prompt_text`, and returns it. The builder assembles:

1. Role and exam label: "You are an SSC 2027 (class 9–10) question setter…".
2. Chapter identity: subject code, chapter number, exact chapter title.
3. Output contract: one JSON object, no fences, no citation markers, no prose,
   keys preserved, language of the source.
4. Kind-specific rules, from the chosen pattern and marks.
5. Avoid list, scoped to **this chapter** (and the kinds being asked for):
   - MCQs and standalone shorts: their prompts, normalised.
   - Passages: `passage_stem` when present, otherwise the stem derived at query
     time from a legacy prompt beginning `উদ্দীপক:` by cutting at the first
     `(<part>)`. Rows that do not match either shape contribute their full
     prompt instead.
   - Newest first, trimmed to 120 characters, capped at 200 entries. Over the
     cap, older entries are replaced by a topic list drawn from the chapter
     summary.
6. Count, and the "return fewer rather than invent" rule.
7. Page numbers: ask for the printed page as `page_number`, and say explicitly
   that a guess is worse than `null`. A returned page is stored as a **claim**;
   it is not evidence. The job row shows how many imported rows still have an
   unverified page, linking to Correct existing → Search whole chapter.

The avoid list is chapter-scoped because the work order is per chapter; the
importer's duplicate rule stays subject-wide (see §8.3), so a cross-chapter
repeat is reported rather than silent.

Nothing about the format lives in the UI as free text; it is rendered from the
pattern record. Editing a format is one row edit, not a new prompt per chapter.

### 8.3 Reply import

`POST /api/jobs/:id/runs/:runId/import { payload }`.

Client-side sanitizer (before POST, pure function, unit-tested):

- strip ``` fences and any text before the first `{` or `[`;
- strip citation markers `[1]`, `[12]`;
- normalise curly quotes to straight quotes;
- remove trailing commas before `}`/`]`;
- accept one object, an array of objects, or `{questions:[…]}`.

**One reply, one kind.** A run asks for exactly one kind, so a reply that
contains rows of another kind is rejected with a per-row message ("this run
asked for mcq; row 4 is a passage"). The teacher pastes one reply per work
order. The paste preview therefore shows a single kind at a time.

Server validation per row, by kind:

- `mcq`: exactly four unique options; `answer` is one of them, verbatim (A–D
  accepted and mapped); no `options` on short/long.
- `short` / `long`: `options` must be absent; `marks` taken from the pattern
  when the row omits it.
- `passage` object: `{stem, parts:[{question, answer, scheme}]}`. The server
  expands it: one row per part, type from the pattern, `prompt` =
  `উদ্দীপক: <stem> (<part>) <question>`, shared `passage_group`,
  `passage_stem`, `passage_part`, `passage_index`, `explanation` = scheme.
  A part count or mark mismatch rejects that passage as a unit.
- `page_number` is optional and stored as claimed. No page is ever marked
  verified here; only the audit in Correct existing can do that.

**A passage is atomic.** If the stem, or any one of its parts, collides with an
existing row or an earlier row in the same file, the whole passage is skipped —
never a partial ক–ঘ group. One skip is counted, and the reason names the
colliding part.

Duplicates: normalised `prompt` (existing rule) plus the normalised stem for
passages — `passage_stem` when present, otherwise the stem derived from a legacy
`উদ্দীপক:` prompt as in §8.2 — checked against the subject (the existing scope)
and the current file. `skip_duplicates` stays default-on. Skips are reported in
two buckets — already in this chapter, and already elsewhere in the subject — so
a cross-chapter collision is visible instead of quietly shrinking the run.

Rows are inserted with `job_id` and `generation_run_id`. `imported` counts
units (a passage counts once) and `imported_rows` counts rows; both are written
in the same transaction. Per-row errors are reported and never abort the file.

Undo: `POST /api/jobs/:id/runs/:runId/undo` deletes exactly
`generation_run_id = ?` rows and then calls `pruneQuestionsFromExams` with the
deleted ids, matching Batch Studio's undo. The run row is **kept** and stamped
`undone_at`, so the stored prompt and history survive and the run cannot be
undone twice. Undo therefore also removes those questions from any exam that
already used them, recomputes that exam's marks, and unpublishes an exam left
empty — the same behaviour `bulk-delete` and `undoBatch` have today.

### 8.4 UI

Batch Studio gains a third tab, **NotebookLM**, next to Generate and Correct.

```
NotebookLM jobs                                     [+ New job]
BGS · Ch 3  The Political Movement…    34/40 MCQ · 6/12 CQ   [Copy prompt] [Paste reply] [Runs]
ICT · Ch 5  Number Systems             12/40 MCQ · 0/10 CQ   [Copy prompt] [Paste reply] [Runs]
```

- **New job**: subject, chapter, pattern (preselected from the subject; Bangla
  উপন্যাস/নাটক suggested by title match), exam label, targets per kind.
- **Copy prompt**: pick the kind and the count for that kind, copy to
  clipboard, toast confirms.
- **Paste reply**: textarea, live preview for the run's kind ("6 passages →
  24 rows"), then Import and a result summary with per-row failures and both
  skip buckets.
- **Runs**: list with date, kind, requested/imported/imported_rows/skipped/
  failed, an **undone** badge with its date, "copy this prompt again", "undo
  this run" (disabled once undone).
- **Unverified pages**: a line on each job — "18 imported rows with no verified
  page" — linking to Correct existing with the chapter preselected.
- **Patterns**: a small editor (list, add, edit, delete) for name, subject,
  chapter-title match and the parts list with kind and marks. Reached from the
  NotebookLM tab; no database access needed to add a format.
- Question Bank keeps its file import unchanged.

All controls come from `ui.tsx`; no raw `<select>` or file input.

### 8.5 Patterns seed

- `SSC CQ (default)` — mcq 1; passage parts 1,2,3,4; short 2. Default for
  subjects with no more specific row.
- `Bangla 1st — উপন্যাস/নাটক` — passage parts 3 (short) and 7 (long); no mcq.
  Selected when the chapter title matches `উপন্যাস|নাটক`.
- `SSC short` — short 2, no passage.

The teacher may add or edit patterns; the matrix is data, not code.

### 8.6 Migration and safety

Bump `SCHEMA_VERSION`, add tables and columns via `ensureColumn`, keep the
existing pre-migration backup. Reversible: dropping the new tables/columns
loses only job metadata, never questions.

## 9. Left to the builder

- Exact wording of each work-order section, and the JSON key names inside a
  passage reply.
- Part letters for a two-part Bangla passage (ক, খ versus 1, 2).
- Where the sanitizer lives so Batch Studio can reuse it.
- Table/route naming (`/api/jobs` versus `/api/generation-jobs`).
- How the pattern editor is reached (modal, sub-tab, separate page) and its
  exact fields.
- The shape of the "unverified page" deep link into Correct existing.

## 10. Deferred — chunk 3 (paper rendering)

Storing `passage_group` is not enough to print a CQ correctly. Currently exam
selection is a flat `question_ids` list and `shuffle_questions` can scatter the
parts of one stem. Chunk 3 covers: group-aware selection in the exam builder,
one printed stem with ক/খ/গ/ঘ beneath it, group totals of 10, and grouped
display in Results and Practice. Out of scope here.

## 11. Test plan

- Unit: sanitizer strips fences, citations, trailing commas; rejects prose.
- Unit: pattern rendering produces the right marks per kind.
- Unit: legacy stem derivation cuts `উদ্দীপক: <stem> (ক) …` at the part marker
  and falls back to the full prompt when the shape is unknown.
- API: mcq/short/passage imports; 4-option gate; answer mapping; passage
  expansion; group ids; duplicate by prompt and by stem; per-row failures.
- API: a passage with one colliding part is skipped whole and counted once.
- API: a reply containing the wrong kind is rejected per row, not imported.
- API: skipped rows are split into in-chapter and elsewhere-in-subject.
- API: work-order returns the chapter-scoped avoid list, including legacy
  stems, and stores `prompt_text`; counters are in units, `imported_rows` in
  rows.
- API: progress counts standalone shorts only, and distinct passage groups.
- API: undo deletes exactly the run's rows, keeps the run row with `undone_at`,
  prunes the ids from exams and recomputes their marks, and refuses a second
  undo.
- API: pattern create/edit/delete; a job keeps its pattern after a pattern edit.
- Integration: fixture of a real NotebookLM reply imports cleanly.
- Manual: one BGS chapter end-to-end, then reopen the job two days later and
  resume from the stored prompt without retyping anything.
- Manual: one Bangla 1st উপন্যাস chapter produces 3+7 rows in one group, and
  does not advance the standalone short target.
- Manual: import a CQ run, add four parts to an exam, undo the run, confirm the
  exam lost exactly those four and its total dropped by 10.
- Theme check, typecheck, lint, build before finishing.
