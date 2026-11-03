# Agent notes

## Frontend theme

The UI is a green, light/dark theme driven by **`frontend/src/theme.css`**.
Tailwind colour utilities (`bg-slate-900`, `text-indigo-300`, …) are re-skinned
by overriding their `--color-*` variables there. A shade that is missing from
one of the two theme blocks silently falls back to stock Tailwind — navy,
pink, or blue controls in a green UI.

Rules:

- Add every new colour shade to **both** the dark (`:root, html[data-theme="dark"]`)
  and light (`html[data-theme="light"]`) blocks.
- Use the shared controls from **`frontend/src/components/ui.tsx`**:
  `Input`, `Textarea`, `NumberInput`, `Select`, `Button`, `Field`, `Card`,
  `Badge`. Do not use a raw `<select>`.
- Do not hardcode colours (`#rrggbb`, `rgb()`, `rgba()`) in application UI.
  `frontend/src/components/Logo.tsx` is the only artwork exception.
- `dark:` follows the site's `data-theme` attribute via
  `@custom-variant dark` in `frontend/src/index.css`. The OS setting must not
  override the user's chosen theme.
- Use `hover:bg-ink/5` (or another theme token) for subtle hover washes, not
  `hover:bg-slate-800` in light mode.
- The printable paper (`frontend/src/lib/printTemplate.ts`) is intentionally
  light; do not theme it.

Before finishing a frontend change, run:

```bash
cd frontend
npm run theme:check
npm run typecheck
npm run lint
npm run build
```

`npm run build` runs the theme check first, so a violation fails the Vercel
deployment instead of shipping.
