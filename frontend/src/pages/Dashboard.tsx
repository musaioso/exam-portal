import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { Card } from "../components/ui";
import { BookOpen, ClipboardList, Users, FileQuestion } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>({ subjects: 0, questions: 0, exams: 0, students: 0 });
  useEffect(() => {
    (async () => {
      try {
        const [s, q, e, u] = await Promise.all([
          api.get("/subjects"),
          api.get("/questions"),
          api.get("/exams"),
          user?.role !== "student" ? api.get("/users") : Promise.resolve({ data: { users: [] } }),
        ]);
        setStats({ subjects: s.data.subjects.length, questions: q.data.questions.length, exams: e.data.exams.length, students: u.data.users.filter((x:any)=>x.role==="student").length });
      } catch {}
    })();
  }, [user]);
  const isStudent = user?.role === "student";
const cards = isStudent
    ? [
        { label: "Available Exams", value: stats.exams, icon: ClipboardList, color: "text-cyan-300" },
      ]
    : [
        { label: "Subjects", value: stats.subjects, icon: BookOpen, color: "text-cyan-300" },
        { label: "Questions", value: stats.questions, icon: FileQuestion, color: "text-indigo-300" },
        { label: "Exams", value: stats.exams, icon: ClipboardList, color: "text-emerald-300" },
        { label: "Students", value: stats.students, icon: Users, color: "text-amber-300" },
      ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user?.name}</h1>
        <p className="text-slate-400 text-sm">{isStudent ? "Student portal · NCTB 2025 · Take exams & view results" : "NCTB 2025 · English Version · Chapter-based question management"}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map(c => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-400">{c.label}</div>
                  <div className="text-3xl font-bold mt-1">{c.value}</div>
                </div>
                <Icon size={28} className={`card-icon ${c.color}`} />
              </div>
            </Card>
          );
        })}
      </div>
      <Card>
        <h2 className="font-semibold mb-2">{isStudent ? "Student quick start" : "Quick start"}</h2>
        <ul className="text-sm text-slate-300 space-y-1 list-disc ml-5">
          {isStudent ? (
            <>
              <li>Open <span className="text-cyan-300">Exams</span> to view available papers and start an attempt.</li>
              <li>Answer MCQ, short and long questions — answers auto-save.</li>
              <li>Check your scores and feedback on <span className="text-emerald-300">Results</span>.</li>
            </>
          ) : (
            <>
              <li>Manage subjects & chapters from "Subjects & Chapters".</li>
              <li>Build a question bank with MCQ / Short / Long answers.</li>
              <li>Create exams, publish, and let students attempt online.</li>
              <li>Print question papers with answer keys and mark schemes.</li>
            </>
          )}
        </ul>
      </Card>
    </div>
  );
}