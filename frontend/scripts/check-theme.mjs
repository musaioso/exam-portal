#!/usr/bin/env node
/**
 * Theme consistency guard.
 *
 * The site re-skins Tailwind's colour utilities by overriding `--color-*`
 * variables in src/theme.css. That only works when a shade exists in BOTH the
 * light and dark blocks — otherwise Tailwind's stock colour leaks through and
 * a navy / pink / blue control appears in the green UI.
 *
 * This script also keeps every dropdown on the shared themed <Select> and
 * stops hardcoded colours creeping into application UI.
 *
 * Run with: npm run theme:check   (also runs before `vite build`)
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

const PALETTE = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

const UTILITY_PREFIXES = [
  "bg", "text", "border", "from", "via", "to", "ring", "shadow", "fill",
  "stroke", "decoration", "outline", "divide", "placeholder", "file",
  "accent", "caret",
];

const COLOUR_TOKEN = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9-])(?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?:)*(?:${UTILITY_PREFIXES.join("|")})-(${PALETTE.join("|")})-(\d{2,3})(?!\d)`,
  "g",
);

const errors = [];
const rel = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
const addError = (file, line, message) => {
  errors.push(`${rel(file)}${line ? `:${line}` : ""}: ${message}`);
};

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

async function walk(dir, extensions) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, extensions)));
    else if (extensions.includes(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function extractColourVars(block) {
  const keys = new Set();
  for (const match of block.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)) {
    keys.add(`${match[1]}-${match[2]}`);
  }
  return keys;
}

const themeCssPath = path.join(SRC, "theme.css");
const themeCss = await readFile(themeCssPath, "utf8");

const darkMatch = themeCss.match(/:root,\s*html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
const lightMatch = themeCss.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);

const darkVars = extractColourVars(darkMatch?.[1] ?? "");
const lightVars = extractColourVars(lightMatch?.[1] ?? "");

if (!darkMatch || !lightMatch) {
  addError(themeCssPath, 0, 'could not find both the dark (:root, html[data-theme="dark"]) and light (html[data-theme="light"]) blocks');
} else {
  const all = new Set([...darkVars, ...lightVars]);
  for (const key of [...all].sort()) {
    if (!darkVars.has(key)) addError(themeCssPath, 0, `--color-${key} is missing from the dark theme block`);
    if (!lightVars.has(key)) addError(themeCssPath, 0, `--color-${key} is missing from the light theme block`);
  }
}

const indexCssPath = path.join(SRC, "index.css");
const indexCss = await readFile(indexCssPath, "utf8");
if (!/@custom-variant\s+dark\b/.test(indexCss)) {
  addError(indexCssPath, 0, "missing @custom-variant dark; the dark: variant must follow html[data-theme=\"dark\"]");
}

const sourceFiles = await walk(SRC, [".ts", ".tsx"]);
let tokenCount = 0;

for (const file of sourceFiles) {
  const source = await readFile(file, "utf8");
  const name = rel(file);
  const isPrintTemplate = name === "src/lib/printTemplate.ts";

  if (!isPrintTemplate) {
    for (const match of source.matchAll(COLOUR_TOKEN)) {
      tokenCount++;
      const pair = `${match[1]}-${match[2]}`;
      const token = match[0].trim();
      if (!darkVars.has(pair) || !lightVars.has(pair)) {
        const where = !darkVars.has(pair) && !lightVars.has(pair)
          ? "either theme"
          : !darkVars.has(pair)
            ? "the dark theme"
            : "the light theme";
        addError(file, lineAt(source, match.index ?? 0), `${token} uses ${pair}, which is not defined in ${where}`);
      }
    }
  }

  if (file.endsWith(".tsx") && name !== "src/components/ui.tsx" && /<select\b/.test(source)) {
    const index = source.search(/<select\b/);
    addError(file, lineAt(source, index), "raw <select> found — use <Select> from src/components/ui.tsx");
  }

  if (file.endsWith(".tsx") && name !== "src/components/Logo.tsx" && name !== "src/components/ui.tsx") {
    const colourLiteral = /#(?:[0-9a-fA-F]{3,8})\b|\brgba?\(/g;
    for (const match of source.matchAll(colourLiteral)) {
      const line = lineAt(source, match.index ?? 0);
      const lineText = source.split("\n")[line - 1] ?? "";
      if (lineText.includes("data:image/")) continue;
      addError(file, line, `hardcoded colour ${match[0]} — use a theme token`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Theme check failed — ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n`);
  for (const error of errors) console.error(`  ${error}`);
  console.error("\nFix the theme, then run `npm run theme:check` again.");
  process.exit(1);
}

console.log(`Theme check passed — ${sourceFiles.length} files, ${tokenCount} colour tokens.`);
