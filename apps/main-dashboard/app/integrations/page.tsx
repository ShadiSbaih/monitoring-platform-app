import Link from "next/link";

const setup = `import { createLogger } from "@tracebloom/next";

// Server-side only: keep your API key out of browser bundles.
const log = createLogger({
  apiKey: process.env.TRACEBLOOM_API_KEY!,
  baseUrl: process.env.TRACEBLOOM_SERVER_URI!, // API origin + /api/v1
  appName: "my-app",
  environment: process.env.NODE_ENV,
});

log.info("Application started");
await log.flush(); // Await before a short-lived request or job exits.
`;

export default function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="mt-1 text-sm text-muted-foreground">Send server-side logs to Tracebloom with the TypeScript SDK or HTTP.</p>
      </div>
      <section className="space-y-4 rounded-xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold">TypeScript and Next.js</h2>
        <p className="text-sm text-muted-foreground">The SDK is included in this repository at <code>sdks/tracebloom-next</code>. Build it and install the local package into your application. It has not been published to npm.</p>
        <pre className="overflow-x-auto rounded-lg bg-black/30 p-4 text-xs"><code>{setup}</code></pre>
        <p className="text-sm text-muted-foreground">Create an <Link href="/api-keys" className="text-teal-300 underline">API key</Link>, then set the API URL and secret in your server environment. Call <code>await log.close()</code> when a long-running process shuts down.</p>
      </section>
      <section className="space-y-4 rounded-xl border border-white/10 p-6">
        <h2 className="text-lg font-semibold">Any language over HTTP</h2>
        <p className="text-sm text-muted-foreground">POST to <code>/api/v1/logs/send</code> with your <code>x-api-key</code> header and the JSON below. Reuse the same batch ID and payload when retrying.</p>
        <pre className="overflow-x-auto rounded-lg bg-black/30 p-4 text-xs"><code>{JSON.stringify({
          batchId: "54bb0f96-e3e0-4fe1-8db6-dc4d00d580f4",
          logs: [{ type: "info", app_name: "my-app", message: "Application started" }],
        }, null, 2)}</code></pre>
        <p className="text-sm text-muted-foreground">Each batch accepts up to 100 events, with 8 KiB per event and 256 KiB of log data per batch. Personal accounts receive 1,000 events per UTC day.</p>
      </section>
    </div>
  );
}
