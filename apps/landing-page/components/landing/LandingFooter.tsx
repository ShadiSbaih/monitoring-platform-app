import Link from "next/link";
import Logo from "../common/logo";

export function LandingFooter() {
  return (
    <footer className="border-t border-slate-900/80 bg-slate-950">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-6 py-10">
        <Link href="/" aria-label="Tracebloom home"><Logo className="h-8 w-8" textClassName="text-[24px]" /></Link>
        <p className="text-xs text-slate-500">© {new Date().getFullYear()} Tracebloom. Free monitoring for personal projects.</p>
        <nav aria-label="Footer" className="flex gap-5 text-xs text-slate-400">
          <Link href="/#integrations">Setup</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
