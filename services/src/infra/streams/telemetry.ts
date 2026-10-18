let backlog = 0;
export function setBacklog(value: number) {
  backlog = Math.max(0, value);
}
export function changeBacklog(value: number) {
  backlog = Math.max(0, backlog + value);
}
export function getBacklog() {
  return backlog;
}
const samples = new Map<
  string,
  { count: number; started: number; latencies: number[] }
>();
export function recordIngest(
  userId: string,
  count: number,
  receivedAt: number,
) {
  const current = samples.get(userId) ?? {
    count: 0,
    started: Date.now(),
    latencies: [],
  };
  if (Date.now() - current.started > 5_000) {
    current.count = 0;
    current.started = Date.now();
  }
  current.count += count;
  current.latencies.push(Math.max(0, Date.now() - receivedAt));
  current.latencies = current.latencies.slice(-60);
  samples.set(userId, current);
  if (samples.size > 1_000) samples.delete(samples.keys().next().value!);
}
export function getTelemetry(userId: string) {
  const current = samples.get(userId);
  return {
    ingestRate:
      current && Date.now() - current.started < 5_000 ? current.count / 5 : 0,
    avgLatency: current?.latencies.length
      ? current.latencies.reduce((a, b) => a + b, 0) / current.latencies.length
      : 0,
  };
}
