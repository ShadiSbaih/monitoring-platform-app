const dashboard = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3001';
export function LandingFreeLimits() {
  return <section id="limits" className="border-b border-slate-900/80 px-6 py-20"><div className="mx-auto max-w-5xl">
    <h2 className="text-3xl font-semibold text-white">Free monitoring for your applications.</h2>
    <p className="mt-4 text-slate-400">One offering for every personal account. No payment details required.</p>
    <div className="mt-8 grid gap-4 sm:grid-cols-4">{[
      ['1,000', 'logs per day'], ['7 days', 'log retention'], ['3', 'active alerts'], ['3', 'API keys'],
    ].map(([value, label]) => <div key={label} className="border border-white/10 p-6"><p className="text-3xl font-semibold text-teal-300">{value}</p><p className="mt-2 text-sm text-slate-400">{label}</p></div>)}</div>
    <p className="mt-5 text-sm text-slate-400">Shared platform limits apply. Cold starts can delay the first request after inactivity.</p>
    <a href={dashboard + '/sign-up'} className="mt-8 inline-block rounded-lg bg-teal-400 px-5 py-3 font-medium text-slate-950">Create your free account</a>
  </div></section>;
}
