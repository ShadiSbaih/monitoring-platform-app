import { startLogsConsumer } from './nats/consumer';
import { startAlertConsumer } from './nats/alert-consumer';

export async function startWorkers(): Promise<void> {
  await startLogsConsumer();
  await startAlertConsumer();
}
