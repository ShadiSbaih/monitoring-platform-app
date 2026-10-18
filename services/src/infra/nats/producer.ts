import { JSONCodec } from 'nats';
import { getNatsConnection } from './index';

export interface PublishedLogBatch {
  keyId: string;
  userId: string;
  serverReceivedAt: number;
  logs: unknown[];
}

const codec = JSONCodec<PublishedLogBatch>();

export async function publishLogBatch(
  keyId: string,
  userId: string,
  logs: unknown[],
  serverReceivedAt: number,
): Promise<void> {
  const connection = await getNatsConnection();
  await connection.jetstream().publish(
    'logs.ingest',
    codec.encode({ keyId, userId, serverReceivedAt, logs }),
  );
}
