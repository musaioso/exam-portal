import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { chapterLabel } from "../../lib/labels";
import {
  createJob,
  createWorkOrder,
  listJobs,
  listPatterns,
  listRuns,
  type GenerationRun,
  type Job,
  type JobKind,
  type JobTargets,
  type Pattern,
} from "../../lib/jobs";
import { useToast } from "../Toast";
import { Badge, Button, Card, Field, Input, NumberInput, Select } from "../ui";

interface SubjectRow {
  id: string;
  name: string;
  code?: string | null;
}

interface ChapterRow {
  id: string;
  subject_id: string;
  number: number | null;
  title: string;
  title_bn?: string | null;
  part?: string | null;
}

const KIND_LABEL: Record<JobKind, string> = {
  mcq: "MCQ",
  short: "Short",
  passage: "CQ",
};

function patternKinds(pattern: Pattern | null): JobKind[] {
  const kinds: JobKind[] = [];
  for (const part of pattern?.parts ?? []) {
    if (part.kind === "mcq") kinds.push("mcq");
    if (part.kind === "short") kinds.push("short");
    if (part.kind === "passage") kinds.push("passage");
  }
  return Array.from(new Set(kinds));
}

function remainingFor(job: Job, kind: JobKind): number {
  const progress = job.progress;
  if (!progress) return Math.max(job.targets[kind] ?? 0, 0);
  const cell = kind === "passage" ? progress.passage : progress[kind];
  return Math.max(cell.target - cell.done, 0);
}

/** Mirrors the server's pattern choice so the dialog preselects what will be used. */
function suggestPattern(patterns: Pattern[], subjectId: string, chapterTitle: string): Pattern | null {
  const matches = patterns.filter((pattern) => {
    if (!pattern.chapter_match) return false;
    try {
      return new RegExp(pattern.chapter_match).test(chapterTitle);
    } catch {
      return false;
    }
  });
  return matches.find((pattern) => pattern.subject_id === subjectId)
    ?? matches[0]
    ?? patterns.find((pattern) => pattern.subject_id === subjectId)
    ?? patterns.find((pattern) => pattern.is_default === 1)
    ?? patterns[0]
    ?? null;
}

function relativeAge(timestamp: number): string {
  const minutes = Math.max(Math.floor((Date.now() - timestamp) / 60_000), 0);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function Modal({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onMouseDown={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-600/60 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4 pr-6">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-xl p-1.5 text-slate-400 transition hover:bg-ink/10 hover:text-slate-200"
        >
          <X size={16} />
        </button>
        {children}
      </div>
    </div>
  );
}

function NewJobDialog({
  subjects,
  chapters,
  patterns,
  onClose,
  onCreated,
}: {
  subjects: SubjectRow[];
  chapters: ChapterRow[];
  patterns: Pattern[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [patternId, setPatternId] = useState("");
  const [examLabel, setExamLabel] = useState("SSC 2027");
  const [targets, setTargets] = useState<Record<JobKind, string>>({ mcq: "20", passage: "6", short: "5" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subjectChapters = useMemo(
    () => chapters.filter((chapter) => chapter.subject_id === subjectId),
    [chapters, subjectId]
  );

  useEffect(() => {
    setChapterId("");
    setPatternId("");
  }, [subjectId]);

  useEffect(() => {
    if (!chapterId) return;
    const chapter = chapters.find((entry) => entry.id === chapterId);
    const suggestion = suggestPattern(patterns, subjectId, chapter?.title ?? "");
    setPatternId(suggestion?.id ?? "");
  }, [chapterId, chapters, patterns, subjectId]);

  const create = async () => {
    if (!subjectId || !chapterId || busy) return;
    setBusy(true);
    setError("");
    const cleaned: JobTargets = {};
    for (const kind of ["mcq", "passage", "short"] as const) {
      const value = Math.floor(Number(targets[kind]) || 0);
      if (value > 0) cleaned[kind] = value;
    }
    try {
      await createJob({
        subject_id: subjectId,
        chapter_id: chapterId,
        pattern_id: patternId || null,
        exam_label: examLabel.trim() || "SSC 2027",
        targets: cleaned,
      });
      onCreated();
      onClose();
    } catch (e: any) {
      setError(errorMessage(e, "Could not create the job."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New NotebookLM job"
      description="One job remembers the chapter, the format and the target counts."
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Subject">
            <Select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
              <option value="">Pick a subject…</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Chapter">
            <Select
              value={chapterId}
              onChange={(event) => setChapterId(event.target.value)}
              disabled={!subjectId}
            >
              <option value="">Pick a chapter…</option>
              {subjectChapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>{chapterLabel(chapter)}</option>
              ))}
            </Select>
          </Field>

          <Field label="Pattern">
            <Select
              value={patternId}
              onChange={(event) => setPatternId(event.target.value)}
              disabled={patterns.length === 0}
            >
              <option value="">Use the automatic choice…</option>
              {patterns.map((pattern) => (
                <option key={pattern.id} value={pattern.id}>{pattern.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="Exam label">
            <Input value={examLabel} onChange={(event) => setExamLabel(event.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="MCQ target">
            <NumberInput
              min={0}
              max={500}
              value={targets.mcq}
              onChange={(event) => setTargets((current) => ({ ...current, mcq: event.target.value }))}
            />
          </Field>
          <Field label="CQ passages">
            <NumberInput
              min={0}
              max={200}
              value={targets.passage}
              onChange={(event) => setTargets((current) => ({ ...current, passage: event.target.value }))}
            />
          </Field>
          <Field label="Short questions">
            <NumberInput
              min={0}
              max={500}
              value={targets.short}
              onChange={(event) => setTargets((current) => ({ ...current, short: event.target.value }))}
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={create} disabled={!subjectId || !chapterId || busy}>
            {busy ? "Creating…" : "Create job"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CopyPromptDialog({
  job,
  onClose,
  onCopied,
}: {
  job: Job;
  onClose: () => void;
  onCopied: () => void;
}) {
  const toast = useToast();
  const kinds = useMemo(() => patternKinds(job.pattern), [job.pattern]);
  const [kind, setKind] = useState<JobKind>(kinds[0] ?? "mcq");
  const [count, setCount] = useState(() => Math.max(remainingFor(job, kinds[0] ?? "mcq"), 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCount(Math.max(remainingFor(job, kind), 1));
  }, [job, kind]);

  const copy = async () => {
    if (busy || kinds.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const requested = Math.max(Math.floor(Number(count) || 0), 1);
      const { prompt } = await createWorkOrder(job.id, kind, requested);
      await navigator.clipboard.writeText(prompt);
      toast.success(`${KIND_LABEL[kind]} prompt copied — ${requested} requested.`);
      onCopied();
      onClose();
    } catch (e: any) {
      setError(errorMessage(e, "Could not copy the prompt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Copy ${KIND_LABEL[kind]} prompt`}
      description="The exact prompt is stored with the run, so a later session can find it again."
      onClose={onClose}
    >
      <div className="space-y-4">
        {kinds.length === 0 ? (
          <p className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            This job's pattern has no question kind to ask for. Choose another pattern when creating the job.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Kind">
                <Select value={kind} onChange={(event) => setKind(event.target.value as JobKind)}>
                  {kinds.map((entry) => (
                    <option key={entry} value={entry}>{KIND_LABEL[entry]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Count">
                <NumberInput
                  min={1}
                  max={500}
                  value={count}
                  onChange={(event) => setCount(Math.max(1, Number(event.target.value) || 1))}
                />
              </Field>
            </div>
            <p className="text-xs text-slate-400">
              {remainingFor(job, kind)} still needed on this job's target. The default asks for the remainder.
            </p>
          </>
        )}

        {error && (
          <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={copy} disabled={busy || kinds.length === 0}>
            {busy ? "Copying…" : "Copy prompt"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default function NotebookPanel() {
  const navigate = useNavigate();
  const toast = useToast();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [chapters, setChapters] = useState<ChapterRow[]>([]);
  const [latestRun, setLatestRun] = useState<Record<string, GenerationRun | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newJobOpen, setNewJobOpen] = useState(false);
  const [copyJob, setCopyJob] = useState<Job | null>(null);

  const load = useCallback(async () => {
    try {
      const { jobs: rows } = await listJobs();
      setJobs(rows);
      const pairs = await Promise.all(rows.map(async (job) => {
        try {
          const { runs } = await listRuns(job.id);
          return [job.id, runs[0] ?? null] as const;
        } catch {
          return [job.id, null] as const;
        }
      }));
      setLatestRun(Object.fromEntries(pairs));
      setError("");
    } catch (e: any) {
      setError(errorMessage(e, "Could not load NotebookLM jobs."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    listPatterns().then((result) => setPatterns(result.patterns)).catch(() => setPatterns([]));
    api.get("/subjects").then(async (result) => {
      const rows = (result.data.subjects || []) as SubjectRow[];
      setSubjects(rows);
      const lists = await Promise.all(rows.map((subject) =>
        api.get(`/subjects/${subject.id}/chapters`)
          .then((chaptersResult) => (chaptersResult.data.chapters || []) as ChapterRow[])
          .catch(() => [] as ChapterRow[])
      ));
      setChapters(lists.flat());
    }).catch(() => {
      setSubjects([]);
      setChapters([]);
    });
  }, [load]);

  const subjectName = (id: string) => subjects.find((subject) => subject.id === id)?.name ?? "Subject";
  const chapterFor = (id: string) => chapters.find((chapter) => chapter.id === id);

  const auditLink = (job: Job) =>
    `/batch?tab=correct&subject=${encodeURIComponent(job.subject_id)}&chapter=${encodeURIComponent(job.chapter_id)}`;

  return (
    <section className="space-y-4">
      <div className="glass flex flex-wrap items-start justify-between gap-3 p-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">NotebookLM jobs</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            One saved work order per chapter: the format, the targets and what the bank already holds.
            Copy the prompt, paste the reply, and keep the run history.
          </p>
        </div>
        <Button type="button" onClick={() => setNewJobOpen(true)}>+ New job</Button>
      </div>

      {error && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      )}

      {loading && <p className="text-sm text-slate-400">Loading jobs…</p>}

      {!loading && jobs.length === 0 && !error && (
        <div className="glass rounded-2xl p-6 text-sm text-slate-400">
          No jobs yet. Create one for the chapter you are working on; it will remember the pattern and the counts.
        </div>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const chapter = chapterFor(job.chapter_id);
          const run = latestRun[job.id] ?? null;
          const progress = job.progress;
          const counts = [
            `MCQ ${progress?.mcq.done ?? 0}/${progress?.mcq.target ?? 0}`,
            `CQ ${progress?.passage.done ?? 0}/${progress?.passage.target ?? 0}`,
            `Short ${progress?.short.done ?? 0}/${progress?.short.target ?? 0}`,
          ];
          const unverified = job.unverified_pages ?? 0;

          return (
            <Card key={job.id} hover={false} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-100">
                      {subjectName(job.subject_id)}
                      <span className="text-slate-500"> · </span>
                      {chapter ? chapterLabel(chapter) : "Chapter"}
                    </h3>
                    <Badge>{job.pattern?.name ?? "No pattern"}</Badge>
                    <span className="text-xs text-slate-500">{job.exam_label}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{counts.join(" · ")}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {run ? `Last run: ${relativeAge(run.created_at)}` : "No run yet"}
                    {run ? ` · ${KIND_LABEL[run.kind]} asked ${run.requested}` : ""}
                  </p>
                  {unverified > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate(auditLink(job))}
                      className="mt-2 text-xs font-semibold text-amber-300 underline underline-offset-2 transition hover:text-amber-200"
                    >
                      {unverified} imported row{unverified === 1 ? "" : "s"} with no verified page
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" onClick={() => setCopyJob(job)}>Copy prompt</Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(auditLink(job))}
                  >
                    Open audit
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {newJobOpen && (
        <NewJobDialog
          subjects={subjects}
          chapters={chapters}
          patterns={patterns}
          onClose={() => setNewJobOpen(false)}
          onCreated={() => {
            toast.success("Job created.");
            void load();
          }}
        />
      )}

      {copyJob && (
        <CopyPromptDialog
          job={copyJob}
          onClose={() => setCopyJob(null)}
          onCopied={() => { void load(); }}
        />
      )}
    </section>
  );
}
