import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { TriangleAlert } from "lucide-react";

/**
 * Loud banner shown when the API reports that it is running on an ephemeral
 * in-memory database. That happens when no persistent database is configured
 * (TURSO_DATABASE_URL missing), and it means anything the user saves here is
 * thrown away when the server restarts — so we say so instead of losing data
 * silently.
 */
export function StorageWarning({ className }: { className?: string }) {
  const [ephemeral, setEphemeral] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get("/health")
      .then((r) => { if (alive) setEphemeral(r.data?.persistent === false); })
      .catch(() => { /* server unreachable: other screens already report that */ });
    return () => { alive = false; };
  }, []);

  if (!ephemeral) return null;

  return (
    <div className={className}>
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3">
        <TriangleAlert size={18} className="mt-0.5 shrink-0 text-rose-300" />
        <div className="text-sm">
          <div className="font-semibold text-rose-200">Temporary storage — your data is not being saved</div>
          <p className="text-xs text-rose-200/80 mt-0.5 leading-relaxed">
            The server is running without a persistent database, so every exam, question and mark you add here
            disappears as soon as it restarts. Ask the administrator to set{" "}
            <code className="font-mono">TURSO_DATABASE_URL</code> and{" "}
            <code className="font-mono">TURSO_AUTH_TOKEN</code> on the deployment, then redeploy.
          </p>
        </div>
      </div>
    </div>
  );
}
