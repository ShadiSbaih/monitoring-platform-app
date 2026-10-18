import { RetentionPolicy, StorageType } from 'nats';
import { NATS_STREAM_NAME, NATS_STREAM_SUBJECTS } from '../../configs';
import { getNatsConnection } from './index';

export async function initNatsStream(): Promise<void> {
  const connection = await getNatsConnection();
  const manager = await connection.jetstreamManager();
  const streamConfig = {
    name: NATS_STREAM_NAME,
    subjects: [...NATS_STREAM_SUBJECTS],
    retention: RetentionPolicy.Workqueue,
    storage: StorageType.File,
  };

  let existing = false;
  for await (const stream of manager.streams.list()) {
    if (stream.config.name === NATS_STREAM_NAME) {
      existing = true;
      break;
    }
  }

  if (!existing) {
    await manager.streams.add(streamConfig);
    return;
  }

  const current = await manager.streams.info(NATS_STREAM_NAME);
  const currentSubjects = current.config.subjects ?? [];
  const hasAllSubjects = NATS_STREAM_SUBJECTS.every((subject) => currentSubjects.includes(subject));

  if (!hasAllSubjects || currentSubjects.length !== NATS_STREAM_SUBJECTS.length) {
    await manager.streams.update(NATS_STREAM_NAME, { subjects: [...NATS_STREAM_SUBJECTS] });
  }
}
