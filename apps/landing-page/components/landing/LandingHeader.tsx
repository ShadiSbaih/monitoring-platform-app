import Link from 'next/link';
const dashboard = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3001';
export function LandingHeader() {
  return <header className="border-b border-white/10"><nav aria-label="Main navigation" className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5">
    <Link href="/" className="text-lg font-bold text-white">Tracebloom</Link>
    <div className="flex items-center gap-5 text-sm text-slate-300"><Link href="/#features">Features</Link><Link href="/#limits">Free limits</Link>
      <a href={dashboard + '/sign-in'}>Sign in</a><a href={dashboard + '/sign-up'} className="rounded-lg bg-teal-400 px-4 py-2 font-medium text-slate-950">Get started</a>
    </div></nav></header>;
}
