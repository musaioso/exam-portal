// Option labels for MCQ questions. Bangla questions (prompt contains Bangla
// script) use ক খ গ ঘ …; English questions use A B C D … . Matches the logic
// already used in the print preview (src/lib/printTemplate.ts).
const BN = ["ক", "খ", "গ", "ঘ", "ঙ", "চ", "ছ", "জ"];
const EN = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function isBangla(text: string | null | undefined): boolean {
  return /[\u0980-\u09FF]/.test(String(text || ""));
}

export function optionLabels(prompt: string | null | undefined): string[] {
  return isBangla(prompt) ? BN : EN;
}

export function optionLabel(prompt: string | null | undefined, index: number): string {
  const letters = isBangla(prompt) ? BN : EN;
  return letters[index] || String(index + 1);
}