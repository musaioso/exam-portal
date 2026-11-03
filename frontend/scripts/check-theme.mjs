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
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");

export const PALETTE = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

export const UTILITY_PREFIXES = [
  "bg", "text", "border", "from", "via", "to", "ring", "shadow", "fill",
  "stroke", "decoration", "outline", "divide", "placeholder", "file",
  "accent", "caret",
];

// Side/axis forms (`border-t-…`, `divide-x-…`) and ring offsets are valid
// Tailwind utilities too. Without these segments the guard would silently
// miss an off-palette side border — a class the codebase already uses.
export const COLOUR_TOKEN = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9-])(?:[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)?:)*(?:${UTILITY_PREFIXES.join("|")})(?:-[trblxyse])?(?:-offset)?-(${PALETTE.join("|")})-(\d{2,3})(?!\d)`,
  "g",
);

export const COLOUR_LITERAL = /#(?:[0-9a-fA-F]{3,8})\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g;

export function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

/**
 * Replace comments with spaces, preserving every newline and character
 * offset. String/template contents are left intact because Tailwind classes
 * live there.
 */
export function maskComments(source) {
  const out = source.split("");
  let state = "code";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (state === "line") {
      if (char === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        state = "code";
      } else if (char !== "\n") {
        out[i] = " ";
      }
      continue;
    }
    if (state === "single" || state === "double" || state === "template") {
      if (char === "\\") {
        i++;
        continue;
      }
      if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i++;
      state = "line";
    } else if (char === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i++;
      state = "block";
    } else if (char === "'") {
      state = "single";
    } else if (char === '"') {
      state = "double";
    } else if (char === "`") {
      state = "template";
    }
  }
  return out.join("");
}

/** Replace string/template contents with spaces, preserving offsets. */
export function maskStrings(source) {
  const out = source.split("");
  let state = "code";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];

    if (state !== "code") {
      const end =
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`");
      if (char === "\\") {
        if (out[i] !== "\n") out[i] = " ";
        i++;
        if (i < source.length && out[i] !== "\n") out[i] = " ";
        continue;
      }
      if (char !== "\n") out[i] = " ";
      if (end) state = "code";
      continue;
    }

    if (char === "'" ) {
      out[i] = " ";
      state = "single";
    } else if (char === '"') {
      out[i] = " ";
      state = "double";
    } else if (char === "`") {
      out[i] = " ";
      state = "template";
    }
  }
  return out.join("");
}

export function extractColourVars(block) {
  const keys = new Set();
  for (const match of block.matchAll(/--color-([a-z]+)-(\d+)\s*:/g)) {
    keys.add(`${match[1]}-${match[2]}`);
  }
  return keys;
}

export function findColourTokens(source) {
  const masked = maskComments(source);
  const found = [];
  for (const match of masked.matchAll(new RegExp(COLOUR_TOKEN.source, "g"))) {
    found.push({
      index: match.index ?? 0,
      token: match[0].replace(/^[^A-Za-z]+/, ""),
      pair: `${match[1]}-${match[2]}`,
    });
  }
  return found;
}

export function findRawSelects(source) {
  const code = maskStrings(maskComments(source));
  const found = [];
  for (const match of code.matchAll(/<select\b/g)) found.push(match.index ?? 0);
  return found;
}

export function findRawFileInputs(source) {
  const masked = maskComments(source);
  const found = [];
  for (const match of masked.matchAll(/type\s*=\s*["']file["']/g)) found.push(match.index ?? 0);
  return found;
}

export function findHardcodedColours(source) {
  const masked = maskComments(source);
  const found = [];
  for (const match of masked.matchAll(new RegExp(COLOUR_LITERAL.source, "g"))) {
    const line = lineAt(masked, match.index ?? 0);
    const lineText = masked.split("\n")[line - 1] ?? "";
    if (lineText.includes("data:image/")) continue;
    found.push({ index: match.index ?? 0, value: match[0] });
  }
  return found;
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

async function main() {
  const errors = [];
  const rel = (file) => path.relative(ROOT, file).replaceAll("\\", "/");
  const addError = (file, line, message) => {
    errors.push(`${rel(file)}${line ? `:${line}` : ""}: ${message}`);
  };

  const themeCssPath = path.join(SRC, "theme.css");
  const themeCss = maskComments(await readFile(themeCssPath, "utf8"));

  const darkMatch = themeCss.match(/:root,\s*html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  const lightMatch = themeCss.match(/html\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/);

  const darkVars = extractColourVars(darkMatch?.[1] ?? "");
  const lightVars = extractColourVars(lightMatch?.[1] ?? "");

  if (!darkMatch || !lightMatch) {
    addError(themeCssPath, 0, 'could not find both the dark (:root, html[data-theme="dark"]) and light (html[data-theme="light"]) blocks');
  } else {
    const all = new Set([...darkVars, ...lightVars]);
    for (const key of [...all].sort()) {
      const missingInDark = !darkVars.has(key);
      const missingInLight = !lightVars.has(key);
      if (!missingInDark && !missingInLight) continue;
      const index = themeCss.search(new RegExp(`--color-${key}\\s*:`));
      const line = index >= 0 ? lineAt(themeCss, index) : 0;
      if (missingInDark) addError(themeCssPath, line, `--color-${key} is missing from the dark theme block`);
      if (missingInLight) addError(themeCssPath, line, `--color-${key} is missing from the light theme block`);
    }
  }

  const indexCssPath = path.join(SRC, "index.css");
  const indexCss = maskComments(await readFile(indexCssPath, "utf8"));
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
      for (const item of findColourTokens(source)) {
        tokenCount++;
        if (!darkVars.has(item.pair) || !lightVars.has(item.pair)) {
          const where = !darkVars.has(item.pair) && !lightVars.has(item.pair)
            ? "either theme"
            : !darkVars.has(item.pair)
              ? "the dark theme"
              : "the light theme";
          addError(file, lineAt(source, item.index), `${item.token} uses ${item.pair}, which is not defined in ${where}`);
        }
      }
    }

    if (file.endsWith(".tsx") && name !== "src/components/ui.tsx") {
      for (const index of findRawSelects(source)) {
        addError(file, lineAt(source, index), "raw <select> found — use <Select> from src/components/ui.tsx");
      }
      for (const index of findRawFileInputs(source)) {
        addError(file, lineAt(source, index), "raw file input found — use <FileInput> from src/components/ui.tsx");
      }
    }

    if (!isPrintTemplate && name !== "src/components/Logo.tsx") {
      for (const item of findHardcodedColours(source)) {
        addError(file, lineAt(source, item.index), `hardcoded colour ${item.value} — use a theme token`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Theme check failed — ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n`);
    for (const error of errors) console.error(`  ${error}`);
    console.error("\nFix the theme, then run `npm run theme:check` again.");
    process.exitCode = 1;
    return;
  }

  console.log(`Theme check passed — ${sourceFiles.length} files, ${tokenCount} colour tokens.`);
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
