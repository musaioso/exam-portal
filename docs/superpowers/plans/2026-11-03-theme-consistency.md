# Theme Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every off-theme colour and native dropdown from the UI, bring Batch Studio onto the shared design system, and add an automated build-time guard so future work cannot drift.

**Architecture:** Token-first. Complete the light/dark palette in `theme.css`, bind `dark:` to the site's `data-theme`, then replace native controls with the shared `Input`/`Select`/`Button`/`Field` primitives. A zero-dependency Node script scans the source and fails the build on palette gaps, raw selects, hardcoded colours, or theme-block asymmetry.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vite, Node ESM scripts, oxlint.

**Spec:** This plan implements the design approved in the session on 2026-11-03 (summarised in the plan itself).

## Global Constraints

- No new runtime dependencies.
- No backend changes.
- The printable paper (`src/lib/printTemplate.ts`) stays intentionally light; do not theme it.
- App UI colours must come from `src/theme.css` tokens or Tailwind utilities mapped by those tokens.
- No raw `<select>` in `src/**/*.tsx` except the hidden native select inside `src/components/ui.tsx`.
- No hardcoded hex/rgb in `src/**/*.tsx` except brand artwork in `src/components/Logo.tsx` and the SVG data URI in `ui.tsx`.
- The theme checker must run before `vite build` so a violation fails the Vercel deployment.
- Light and dark blocks in `theme.css` must define the same set of `--color-*` shades.

## Review Focus

- **Light-mode hover contrast:** after defining `slate-800`, hovering Batch/Questions rows must not put dark text on a dark navy background.
- **Select value flow:** replacing native selects must preserve `value`, `onChange`, `disabled`, empty-option placeholders, and form submission semantics.
- **Compact Subject merge selects:** the small inline selects must not overflow their row or lose the “From chapter…” / “Into chapter…” placeholder.
- **Batch file picker:** the file input must remain clickable, show the chosen count, and keep the brand-coloured file button in both themes.
- **Boot fallback:** when CSS never loads, the recovery panel must still be readable in light and dark modes.

---

### Task 1: Add the theme guard

**Files:**
- Create: `frontend/scripts/check-theme.mjs`
- Modify: `frontend/package.json`
- Create: `AGENTS.md`

**Interfaces:**
- Produces: `npm run theme:check` → exits `0` when the theme is clean, exits `1` with `file:line: message` lines when not.
- Produces: `npm run lint` and `npm run build` both run the checker first.
- Produces: a root `AGENTS.md` that tells future agents the theme rules and commands.

- [ ] **Step 1: Write the checker as a failing test**

Create `frontend/scripts/check-theme.mjs` with these rules:

1. Parse `src/theme.css`. Extract the `--color-<name>-<shade>` declarations from the dark block (`:root, html[data-theme="dark"]`) and the light block (`html[data-theme="light"]`).
2. Fail if a shade exists in one block but not the other.
3. Fail if `src/index.css` does not contain `@custom-variant dark`.
4. Scan `src/**/*.{ts,tsx}` for Tailwind colour tokens (`bg-`, `text-`, `border-`, `from-`, `via-`, `to-`, `ring-`, `shadow-`, `fill-`, `stroke-`, `decoration-`, `outline-`, `divide-`, `placeholder-`, `file-`, `accent-`, `caret-` followed by a known palette colour and a numeric shade). Fail when that shade is missing from either theme block. Skip `src/lib/printTemplate.ts`.
5. Fail on any `<select` in `src/**/*.tsx` except `src/components/ui.tsx`.
6. Fail on any `#rrggbb` / `rgb()` / `rgba()` literal in `src/**/*.tsx` except `src/components/Logo.tsx`, `src/components/ui.tsx`, and lines that contain `data:image/`.
7. Print a short summary on success: `Theme check passed — N files, M colour tokens.`
8. Keep the palette name list, file walker, and error formatting in this one file; no dependencies.

- [ ] **Step 2: Wire the scripts**

Modify `frontend/package.json`:

```json
"lint": "oxlint && npm run theme:check",
"theme:check": "node scripts/check-theme.mjs",
"build": "npm run theme:check && vite build",
```

Keep the existing `dev`, `typecheck`, `preview` scripts unchanged.

- [ ] **Step 3: Run the checker and confirm it fails**

Run: `cd frontend && npm run theme:check`
Expected: FAIL with the current violations (missing shades, raw selects, missing dark variant). This proves the guard is live.

- [ ] **Step 4: Document the rules for future agents**

Create `AGENTS.md` at the repo root with a `## Frontend theme` section:

- Colours live in `frontend/src/theme.css`; add every new shade to both blocks.
- Use `Input`, `Textarea`, `NumberInput`, `Select`, `Button`, `Field`, `Card`, `Badge` from `frontend/src/components/ui.tsx`.
- Never use a raw `<select>`.
- Never hardcode hex/rgb in app UI; `Logo.tsx` is the only exception.
- `dark:` follows `data-theme` via `@custom-variant`; prefer semantic tokens anyway.
- Run `npm run theme:check` before finishing. `npm run build` runs it automatically.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/check-theme.mjs frontend/package.json AGENTS.md
git commit -m "chore: add theme consistency guard"
```

---

### Task 2: Complete the palette and dark variant

**Files:**
- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: the checker from Task 1.
- Produces: every colour utility used in the app resolves to a themed value in both modes.

- [ ] **Step 1: Add the missing shades to both theme blocks**

Add these to the dark block and, where missing, the light block:

- `slate-800`
- `fuchsia-300`
- `sky-200`, `sky-500`
- `cyan-200`
- `emerald-100`, `emerald-200`
- `amber-100`, `amber-400`, `amber-600`
- `rose-100`
- `teal-400`

Use on-palette values consistent with the existing mapping:

- Dark `slate-800`: `#123626` (between `slate-900` and `slate-700`).
- Light `slate-800`: `#d6ebdf` (between `slate-900` and `slate-700`).
- Teal-family accents (`fuchsia-300`, `sky-200/500`, `cyan-200`, `teal-400`) map to the existing teal scale in both modes.
- Semantic pastels (`emerald-100/200`, `amber-100/400/600`, `rose-100`) stay in their hue families but are dark enough in light mode and light enough in dark mode to match the existing chips.

Add a comment above the block: “Every shade used by the UI must be defined in both blocks; run `npm run theme:check`.”

- [ ] **Step 2: Bind `dark:` to the site theme**

At the top of `frontend/src/index.css`, after the imports, add:

```css
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));
```

- [ ] **Step 3: Re-run the checker**

Run: `cd frontend && npm run theme:check`
Expected: colour and dark-variant errors are gone; only raw-select errors from Task 3 remain.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/theme.css frontend/src/index.css
git commit -m "fix: complete theme palette and data-theme dark variant"
```

---

### Task 3: Replace every raw select with the shared Select

**Files:**
- Modify: `frontend/src/components/ui.tsx`
- Modify: `frontend/src/components/batch/SetupPanel.tsx`
- Modify: `frontend/src/components/batch/CorrectionPanel.tsx`
- Modify: `frontend/src/pages/Subjects.tsx`

**Interfaces:**
- Consumes: `Select` from `components/ui`.
- Produces: `Select` accepts `compact?: boolean`; compact renders `rounded-xl px-3 py-1.5 text-xs` on the trigger while keeping the portal menu themed.

- [ ] **Step 1: Add the compact variant to `Select`**

In `frontend/src/components/ui.tsx`, extend the props with `compact?: boolean` and apply:

```ts
const triggerSize = compact
  ? "rounded-xl px-3 py-1.5 pr-8 text-xs"
  : "rounded-2xl px-4 py-2.5 pr-9 text-sm";
```

Use `triggerSize` in the trigger class list. Move the chevron to `right-2.5` when `compact` is true and keep `right-3` otherwise. Do not change the native hidden select or the portal menu.

- [ ] **Step 2: Replace the four Setup selects**

In `frontend/src/components/batch/SetupPanel.tsx`, replace each `<select className="w-full rounded-xl ...">` with `<Select value={...} onChange={...} disabled={...}>` and keep the same `<option>` children.

- [ ] **Step 3: Replace the four Correction selects**

In `frontend/src/components/batch/CorrectionPanel.tsx`, do the same for subject, chapter, source batch, and audit scope. Keep `disabled={!subjectId}` on chapter and source batch.

- [ ] **Step 4: Replace the three Subjects selects**

In `frontend/src/pages/Subjects.tsx`, replace the merge-canonical select and the two manual-merge selects with `<Select compact ...>`. Use `className="w-auto"` where the old select was inline-sized. Keep the existing `value` / `onChange` logic verbatim.

- [ ] **Step 5: Run the checker**

Run: `cd frontend && npm run theme:check`
Expected: PASS. No raw `<select>` remains outside `ui.tsx`.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npm run typecheck`
Expected: PASS with no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ui.tsx frontend/src/components/batch/SetupPanel.tsx frontend/src/components/batch/CorrectionPanel.tsx frontend/src/pages/Subjects.tsx
git commit -m "fix: use themed Select everywhere"
```

---

### Task 4: Bring Batch Studio onto the shared controls

**Files:**
- Modify: `frontend/src/components/batch/SetupPanel.tsx`
- Modify: `frontend/src/components/batch/CorrectionPanel.tsx`
- Modify: `frontend/src/components/batch/RunPanel.tsx`
- Modify: `frontend/src/components/batch/AuditSheet.tsx`
- Modify: `frontend/src/components/batch/EvidenceTable.tsx`
- Modify: `frontend/src/pages/Batch.tsx`

**Interfaces:**
- Consumes: `Input`, `NumberInput`, `Select`, `Button`, `Field` from `components/ui`.
- Produces: Batch Studio uses the same field radius, focus ring, button variants, and hover washes as the rest of the app.

- [ ] **Step 1: SetupPanel fields**

Replace raw text/number inputs with `Input` / `NumberInput`, raw labels with `Field`, and the submit button with `Button variant="primary"`. For the file input, use `rounded-2xl`, the same border/background/focus-ring classes as `Input`, and `file:rounded-xl file:bg-indigo-500 file:font-semibold`. Keep the selected-image count.

- [ ] **Step 2: CorrectionPanel buttons and notices**

Replace the six action buttons with `Button` (primary / outline / ghost) and keep semantic colour overrides via `className` where the action is violet, emerald, or rose. Change `rounded-xl` notices to `rounded-2xl`. Keep the table controls readable.

- [ ] **Step 3: RunPanel controls**

Replace raw action buttons with `Button` variants. Change stat tiles and notices to `rounded-2xl`. Keep the progress bar; `bg-slate-800` is now a themed token.

- [ ] **Step 4: AuditSheet controls**

Replace the small raw buttons with `Button size="sm" variant="outline"` and the numeric inputs with `Input type="number"` (or `NumberInput`) using the same compact widths. Change table wrappers to `rounded-2xl`.

- [ ] **Step 5: EvidenceTable controls**

Replace the Undo button with `Button size="sm" variant="outline"` plus rose styling. Keep the filter pills but give the active pill the brand token and the inactive pill the themed hover (`hover:bg-ink/5`) instead of `hover:bg-slate-800/60`. Change table wrappers to `rounded-2xl`.

- [ ] **Step 6: Batch tabs and recent list**

Replace the raw tab buttons in `frontend/src/pages/Batch.tsx` with `Button variant={active ? "primary" : "outline"}`. Change recent-batch row hover to `hover:bg-ink/5` and `rounded-2xl`.

- [ ] **Step 7: Verify**

Run: `cd frontend && npm run theme:check && npm run typecheck && npm run lint`
Expected: PASS for all three.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/batch frontend/src/pages/Batch.tsx
git commit -m "style: align Batch Studio controls with the shared theme"
```

---

### Task 5: Theme the boot fallback panel

**Files:**
- Modify: `frontend/index.html`

**Interfaces:**
- Consumes: `document.documentElement.getAttribute("data-theme")` set by the boot script above it.
- Produces: a recovery panel that uses the green palette in both modes even when the app CSS never loads.

- [ ] **Step 1: Make the inline panel theme-aware**

In the recovery IIFE, read `data-theme` once (`var dark = ... === "dark"`) and choose:

- Background: `#04120b` dark / `#f5fbf7` light.
- Text: `#eef8f2` dark / `#0b2417` light.
- Muted text: `#8bb39c` dark / `#456b55` light.
- Button gradient: `linear-gradient(90deg,#10b981,#14b8a6)`.
- Add `border:1px solid` with the matching border token so the panel reads as a card.

Keep the Bengali copy and the retry behaviour unchanged.

- [ ] **Step 2: Verify the build**

Run: `cd frontend && npm run build`
Expected: PASS, including `Theme check passed`.

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "fix: theme-aware boot recovery panel"
```

---

### Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Install frontend dependencies if needed**

Run: `cd frontend && npm install`
Expected: dependencies installed, no audit-blocking errors.

- [ ] **Step 2: Run every gate**

Run, in order:

```bash
cd frontend
npm run theme:check
npm run typecheck
npm run lint
npm run build
```

Expected: all four PASS. `build` must print `Theme check passed` before Vite output.

- [ ] **Step 3: Manual light/dark smoke test**

Start the frontend (`npm run dev`) and, if the backend is available, sign in and inspect:
- Batch Studio: Setup, Correction, Run, Audit, Evidence, tabs.
- Subjects: duplicate/merge selects.
- Generate: page-range warning, env badge.
- Spelling and Proofreading: header icons.
- Login/Register: theme toggle and panel.

Toggle light/dark and confirm: no navy/pink/blue leaks, no unreadable hover text, no native select popups, and the compact selects open the same themed menu as the large ones.

- [ ] **Step 4: Report**

Summarise changed files, the checker’s output, and any remaining visual caveats. Do not claim success without the command output.

---

## Self-Review

- **Spec coverage:** palette gaps (Task 2), dark variant (Task 2), raw selects (Task 3), Batch controls (Task 4), fallback panel (Task 5), automated guard + agent rules (Task 1), verification (Task 6).
- **Type consistency:** `Select` gains one optional prop (`compact`); all other components keep their existing signatures. `theme:check` is the single new command name used everywhere.
- **Review focus:** the five risk areas above each have a verification step in the owning task.
- **Proportion:** the plan defers implementation bodies to the implementer and keeps code blocks to the exact interfaces and script wiring.
