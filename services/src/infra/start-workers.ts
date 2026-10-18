import { STREAMS } from '../configs';
import { ensureStreams, runConsumer } from './streams/queue';
import { processIngest } from './streams/consumer';
import { processAlerts } from './streams/alert-consumer';
export async function startWorkers() {
  await ensureStreams();
  runConsumer(STREAMS.ingest, processIngest);
  runConsumer(STREAMS.alerts, processAlerts);
}
