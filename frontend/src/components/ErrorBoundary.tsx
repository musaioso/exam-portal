import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time crashes (a missing import, a bad reference) so a student
 * sees a recoverable panel instead of a blank page. The reload button busts the
 * cache, which is what actually rescues a browser stuck on a stale bundle.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Keep the real reason in the console for debugging.
    console.error("[ui] render crashed:", error);
  }

  bust = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("v", Date.now().toString());
    window.location.replace(url.toString());
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold">অ্যাপটি লোড হয়নি</h1>
          <p className="mt-3 text-sm text-slate-400">
            আপনার ব্রাউজারে পুরনো সংস্করণের ফাইল সংরক্ষিত আছে। রিফ্রেশ করলে নতুন সংস্করণ লোড হবে।
          </p>
          <pre className="mt-4 overflow-auto rounded-xl bg-slate-900 p-3 text-left text-xs text-rose-300">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={this.bust}
            className="mt-5 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-400 px-5 py-2.5 text-sm font-semibold text-white"
          >
            রিফ্রেশ করুন
          </button>
        </div>
      </div>
    );
  }
}
