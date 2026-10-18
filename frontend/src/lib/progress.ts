import {
  Award, BadgeCheck, Flame, GraduationCap, Sparkles, Target, Trophy, Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Pure helpers behind the student's progress furniture: study streak, the badge
 * case, and the per-subject breakdown. Kept out of the pages so Dashboard and
 * Profile agree on what "average" and "streak" mean.
 */

const dayKey = (t: number) => new Date(t).toDateString();

/** Distinct days on which an attempt was started or submitted. */
function activeDays(attempts: any[]): Set<string> {
  const days = new Set<string>();
  for (const a of attempts) {
    const t = a.submitted_at || a.started_at;
    if (t) days.add(dayKey(Number(t)));
  }
  return days;
}

/**
 * Consecutive days with at least one attempt, counting back from today. A
 * streak that began yesterday is not broken yet — they still have today.
 */
export function streakDays(attempts: any[]): number {
  const days = activeDays(attempts);
  if (!days.size) return 0;
  const cur = new Date();
  if (!days.has(dayKey(cur.getTime()))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(cur.getTime()))) {
    n += 1;
    cur.setDate(cur.getDate() - 1);
  }
  return n;
}

/** Only attempts that were actually marked count towards the score line. */
export function gradedAttempts(attempts: any[]): any[] {
  return attempts.filter(a => a.status !== "in_progress" && Number(a.total) > 0);
}

export function averagePct(attempts: any[]): number {
  const rows = gradedAttempts(attempts);
  if (!rows.length) return 0;
  const sum = rows.reduce((s, a) => s + (Number(a.score) / Number(a.total)) * 100, 0);
  return Math.round(sum / rows.length);
}

export function bestPct(attempts: any[]): number {
  const rows = gradedAttempts(attempts);
  if (!rows.length) return 0;
  return Math.round(Math.max(...rows.map(a => (Number(a.score) / Number(a.total)) * 100)));
}

export interface BadgeDef {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  earned: boolean;
}

/**
 * The badge case. Every rule is deliberately easy to state out loud so a
 * student can see what to aim at next.
 */
export function badges(input: {
  attempts: any[];
  streak: number;
  passed: number;
}): BadgeDef[] {
  const { attempts, streak, passed } = input;
  const average = averagePct(attempts);
  const best = bestPct(attempts);
  const taken = attempts.length;

  const rules: Array<Omit<BadgeDef, "earned"> & { earned: boolean }> = [
    { id: "first", label: "প্রথম ধাপ", hint: "প্রথম পরীক্ষা দিন", icon: Sparkles, earned: taken >= 1 },
    { id: "five", label: "অভ্যাস", hint: "৫টি পরীক্ষা দিন", icon: Target, earned: taken >= 5 },
    { id: "twentyfive", label: "অধ্যয়নশীল", hint: "২৫টি পরীক্ষা দিন", icon: GraduationCap, earned: taken >= 25 },
    { id: "pass", label: "উত্তীর্ণ", hint: "একটি পরীক্ষাতে পাস করুন (৩৩%)", icon: BadgeCheck, earned: passed >= 1 },
    { id: "strong", label: "সুদৃঢ়", hint: "গড়ে ৭০% পৌঁছান", icon: Award, earned: average >= 70 },
    { id: "top", label: "চমকপ্রদ", hint: "গড়ে ৯০% পৌঁছান", icon: Trophy, earned: average >= 90 },
    { id: "perfect", label: "নিখুঁত", hint: "একটি পরীক্ষায় ১০০%", icon: Zap, earned: best >= 100 },
    { id: "streak3", label: "ধারাবাহিক", hint: "পরপর ৩ দিন পড়াশোনা", icon: Flame, earned: streak >= 3 },
    { id: "streak7", label: "অবিচল", hint: "পরপর ৭ দিন পড়াশোনা", icon: Flame, earned: streak >= 7 },
  ];
  return rules;
}

export interface SubjectStat {
  id: string;
  name: string;
  attempts: number;
  average: number;
}

/**
 * Average score per subject, by joining each attempt to its exam's subject.
 * Sorted best-first so the weak subject is always last in the list.
 */
export function subjectBreakdown(attempts: any[], exams: any[], subjects: any[]): SubjectStat[] {
  const examSubject = new Map<string, string>();
  for (const e of exams) {
    const sid = e.subject_id || (Array.isArray(e.subject_ids) ? e.subject_ids[0] : null);
    if (sid) examSubject.set(e.id, sid);
  }
  const nameOf = new Map<string, string>(subjects.map((s: any) => [s.id, s.name]));

  const buckets = new Map<string, { sum: number; n: number }>();
  for (const a of gradedAttempts(attempts)) {
    const sid = examSubject.get(a.exam_id);
    if (!sid) continue;
    const b = buckets.get(sid) || { sum: 0, n: 0 };
    b.sum += (Number(a.score) / Number(a.total)) * 100;
    b.n += 1;
    buckets.set(sid, b);
  }

  const out: SubjectStat[] = [];
  for (const [sid, b] of buckets)
    out.push({ id: sid, name: nameOf.get(sid) || "বিষয়", attempts: b.n, average: Math.round(b.sum / b.n) });
  return out.sort((x, y) => y.average - x.average);
}
