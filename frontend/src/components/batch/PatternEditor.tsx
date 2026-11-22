import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../lib/api";
import {
  deletePattern,
  listPatterns,
  savePattern,
  type Pattern,
  type PatternPart,
} from "../../lib/jobs";
import { confirmDialog } from "../Dialog";
import { useToast } from "../Toast";
import { Badge, Button, Field, Input, NumberInput, Select } from "../ui";
import Modal from "./Modal";

interface SubjectRow {
  id: string;
  name: string;
}

type PlainKind = "mcq" | "short" | "long";
type DraftKind = PlainKind | "passage";

interface DraftChild {
  key: string;
  kind: "short" | "long";
  marks: string;
}

interface DraftPart {
  key: string;
  kind: DraftKind;
  marks: string;
  children: DraftChild[];
}

interface Draft {
  id: string | null;
  name: string;
  subjectId: string;
  chapterMatch: string;
  parts: DraftPart[];
}

let keySeq = 0;
const newKey = () => `pk-${++keySeq}`;

const KIND_LABEL: Record<DraftKind, string> = {
  mcq: "MCQ",
  short: "Short",
  long: "Long",
  passage: "Passage (CQ)",
};

function defaultChildren(): DraftChild[] {
  return [
    { key: newKey(), kind: "short", marks: "3" },
    { key: newKey(), kind: "long", marks: "7" },
  ];
}

function newDraft(): Draft {
  return {
    id: null,
    name: "",
    subjectId: "",
    chapterMatch: "",
    parts: [{ key: newKey(), kind: "mcq", marks: "1", children: [] }],
  };
}

function toDraft(pattern: Pattern): Draft {
  return {
    id: pattern.id,
    name: pattern.name,
    subjectId: pattern.subject_id ?? "",
    chapterMatch: pattern.chapter_match ?? "",
    parts: pattern.parts.map((part) => ({
      key: newKey(),
      kind: part.kind,
      marks: part.marks != null ? String(part.marks) : "1",
      children: part.kind === "passage"
        ? (part.parts ?? []).map((child) => ({
          key: newKey(),
          kind: child.kind === "short" ? "short" : "long",
          marks: child.marks != null ? String(child.marks) : "1",
        }))
        : [],
    })),
  };
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** One-line summary for the list, e.g. `MCQ 1 · CQ 1+2+3+4 · Short 2`. */
function describePart(part: PatternPart): string {
  if (part.kind === "passage") {
    const marks = (part.parts ?? []).map((child) => child.marks).join("+");
    return `CQ ${marks || "?"}`;
  }
  return `${KIND_LABEL[part.kind]} ${part.marks ?? "?"}`;
}

function validate(draft: Draft): string {
  if (!draft.name.trim()) return "Give the pattern a name.";
  if (draft.parts.length === 0) return "A pattern needs at least one part.";
  if (draft.chapterMatch.trim()) {
    try {
      new RegExp(draft.chapterMatch.trim());
    } catch {
      return "The chapter-title match is not a valid regular expression.";
    }
  }
  for (let index = 0; index < draft.parts.length; index++) {
    const part = draft.parts[index];
    if (part.kind === "passage") {
      if (part.children.length < 2 || part.children.length > 6) {
        return `Part ${index + 1} is a passage, so it needs 2 to 6 parts.`;
      }
      for (let childIndex = 0; childIndex < part.children.length; childIndex++) {
        if (positiveInteger(part.children[childIndex].marks) === null) {
          return `Part ${index + 1}.${childIndex + 1} needs a whole-number mark above zero.`;
        }
      }
    } else if (positiveInteger(part.marks) === null) {
      return `Part ${index + 1} needs a whole-number mark above zero.`;
    }
  }
  return "";
}

function toPayload(draft: Draft): PatternPart[] {
  return draft.parts.map((part) => {
    if (part.kind === "passage") {
      return {
        kind: "passage",
        parts: part.children.map((child) => ({
          kind: child.kind,
          marks: positiveInteger(child.marks) ?? 1,
        })),
      };
    }
    return { kind: part.kind, marks: positiveInteger(part.marks) ?? 1 };
  });
}

function PatternForm({
  draft,
  subjects,
  saving,
  error,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  subjects: SubjectRow[];
  saving: boolean;
  error: string;
  onChange: (next: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const setPart = (index: number, patch: Partial<DraftPart>) =>
    onChange({
      ...draft,
      parts: draft.parts.map((part, i) => (i === index ? { ...part, ...patch } : part)),
    });

  const changeKind = (index: number, kind: DraftKind) => {
    const part = draft.parts[index];
    setPart(index, {
      kind,
      children: kind === "passage" && part.children.length < 2 ? defaultChildren() : part.children,
    });
  };

  const setChild = (index: number, childIndex: number, patch: Partial<DraftChild>) => {
    const part = draft.parts[index];
    setPart(index, {
      children: part.children.map((child, i) => (i === childIndex ? { ...child, ...patch } : child)),
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={draft.name}
            placeholder="e.g. SSC CQ (default)"
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label="Subject">
          <Select
            value={draft.subjectId}
            onChange={(event) => onChange({ ...draft, subjectId: event.target.value })}
          >
            <option value="">All subjects</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>{subject.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Chapter-title match (optional regular expression)">
        <Input
          value={draft.chapterMatch}
          placeholder="e.g. উপন্যাস|নাটক"
          onChange={(event) => onChange({ ...draft, chapterMatch: event.target.value })}
        />
      </Field>
      <p className="-mt-2 text-xs text-slate-500">
        A chapter whose title matches this is given the pattern automatically, ahead of any subject-wide or default pattern.
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-200">Parts, in order</h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onChange({
              ...draft,
              parts: [...draft.parts, { key: newKey(), kind: "mcq", marks: "1", children: [] }],
            })}
          >
            + Add part
          </Button>
        </div>

        {draft.parts.map((part, index) => (
          <div key={part.key} className="space-y-3 rounded-2xl border border-slate-700/60 bg-slate-900/40 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-40">
                <Field label={`Part ${index + 1}`}>
                  <Select
                    compact
                    value={part.kind}
                    onChange={(event) => changeKind(index, event.target.value as DraftKind)}
                  >
                    {(["mcq", "short", "long", "passage"] as const).map((kind) => (
                      <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {part.kind !== "passage" && (
                <div className="w-24">
                  <Field label="Marks">
                    <NumberInput
                      min={1}
                      max={100}
                      value={part.marks}
                      onChange={(event) => setPart(index, { marks: event.target.value })}
                    />
                  </Field>
                </div>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto text-rose-200 hover:bg-rose-500/10"
                disabled={draft.parts.length === 1}
                onClick={() => onChange({ ...draft, parts: draft.parts.filter((_, i) => i !== index) })}
              >
                Remove part
              </Button>
            </div>

            {part.kind === "passage" && (
              <div className="space-y-2 border-l border-slate-700/60 pl-3">
                <p className="text-xs text-slate-500">
                  Each passage becomes one group of these parts. A passage needs 2 to 6 parts.
                </p>
                {part.children.map((child, childIndex) => (
                  <div key={child.key} className="flex flex-wrap items-end gap-2">
                    <div className="w-32">
                      <Field label={`Passage part ${childIndex + 1}`}>
                        <Select
                          compact
                          value={child.kind}
                          onChange={(event) => setChild(index, childIndex, { kind: event.target.value as "short" | "long" })}
                        >
                          <option value="short">Short</option>
                          <option value="long">Long</option>
                        </Select>
                      </Field>
                    </div>
                    <div className="w-24">
                      <Field label="Marks">
                        <NumberInput
                          min={1}
                          max={100}
                          value={child.marks}
                          onChange={(event) => setChild(index, childIndex, { marks: event.target.value })}
                        />
                      </Field>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="ml-auto text-rose-200 hover:bg-rose-500/10"
                      disabled={part.children.length <= 2}
                      onClick={() => setPart(index, {
                        children: part.children.filter((_, i) => i !== childIndex),
                      })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={part.children.length >= 6}
                  onClick={() => setPart(index, {
                    children: [...part.children, { key: newKey(), kind: "long", marks: "1" }],
                  })}
                >
                  + Add passage part
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Back</Button>
        <Button type="button" onClick={onSave} disabled={saving || draft.parts.length === 0}>
          {saving ? "Saving…" : draft.id ? "Save pattern" : "Create pattern"}
        </Button>
      </div>
    </div>
  );
}

export default function PatternEditor({
  subjects,
  onClose,
  onSaved,
}: {
  subjects: SubjectRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState("");

  const subjectName = useMemo(
    () => (id: string) => subjects.find((subject) => subject.id === id)?.name ?? "Subject",
    [subjects]
  );

  const load = useCallback(async () => {
    try {
      const { patterns: rows } = await listPatterns();
      setPatterns(rows);
      setError("");
    } catch (e: any) {
      setError(errorMessage(e, "Could not load the question patterns."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!draft || saving) return;
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await savePattern({
        name: draft.name.trim(),
        subject_id: draft.subjectId || null,
        chapter_match: draft.chapterMatch.trim() || null,
        parts: toPayload(draft),
      }, draft.id ?? undefined);
      toast.success(draft.id ? "Pattern saved." : "Pattern created.");
      setDraft(null);
      await load();
      onSaved();
    } catch (e: any) {
      setError(errorMessage(e, "Could not save the pattern."));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (pattern: Pattern) => {
    if (deleting) return;
    const ok = await confirmDialog({
      title: "Delete this pattern?",
      message: `"${pattern.name}" is removed from the format list. Jobs that use it stay in place and simply lose their pattern; no questions are deleted.`,
      confirmLabel: "Delete pattern",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(pattern.id);
    setError("");
    try {
      await deletePattern(pattern.id);
      toast.success("Pattern deleted. Its jobs kept their questions.");
      await load();
      onSaved();
    } catch (e: any) {
      setError(errorMessage(e, "Could not delete the pattern."));
    } finally {
      setDeleting("");
    }
  };

  return (
    <Modal
      title={draft ? (draft.id ? "Edit question pattern" : "New question pattern") : "Question patterns"}
      description={draft
        ? "The kind and marks of each part. A passage carries its own ordered parts."
        : "The format a work order asks for. Edit it here; no database access needed."}
      size="lg"
      onClose={onClose}
    >
      {draft ? (
        <PatternForm
          draft={draft}
          subjects={subjects}
          saving={saving}
          error={error}
          onChange={setDraft}
          onCancel={() => { setDraft(null); setError(""); }}
          onSave={save}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-400">
              {patterns.length} pattern{patterns.length === 1 ? "" : "s"}. Deleting one never deletes its jobs or questions.
            </p>
            <Button type="button" size="sm" onClick={() => { setError(""); setDraft(newDraft()); }}>
              + New pattern
            </Button>
          </div>

          {error && (
            <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
          )}

          {loading && <p className="text-sm text-slate-400">Loading patterns…</p>}

          {!loading && patterns.length === 0 && !error && (
            <p className="rounded-2xl border border-slate-700/60 bg-slate-900/40 px-4 py-3 text-sm text-slate-400">
              No patterns yet. Add one so jobs can ask NotebookLM for a shape.
            </p>
          )}

          <div className="space-y-2">
            {patterns.map((pattern) => {
              const source = pattern.chapter_match
                ? `“${pattern.chapter_match}”`
                : "any chapter";
              return (
                <div key={pattern.id} className="space-y-2 rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-100">{pattern.name}</h3>
                        {pattern.is_default === 1 && <Badge>default</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {pattern.subject_id ? subjectName(pattern.subject_id) : "All subjects"}
                        <span className="text-slate-600"> · </span>
                        title matches {source}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => { setError(""); setDraft(toDraft(pattern)); }}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="border-rose-500/40 bg-rose-500/10 text-rose-200 hover:border-rose-400/60"
                        disabled={!!deleting}
                        onClick={() => { void remove(pattern); }}
                      >
                        {deleting === pattern.id ? "Deleting…" : "Delete"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-300">
                    {pattern.parts.map(describePart).join(" · ") || "No parts"}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
