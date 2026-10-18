import 'dotenv/config';
import { connect, NatsConnection } from 'nats';

let connection: NatsConnection | undefined;
let connectionPromise: Promise<NatsConnection> | undefined;

export async function getNatsConnection(): Promise<NatsConnection> {
  if (connection) return connection;
  if (connectionPromise) return connectionPromise;

  connectionPromise = connect({
    servers: process.env.NATS_URL ?? 'nats://localhost:4222',
    name: 'oneminutelogs-services',
  })
    .then((connected) => {
      connection = connected;
      connectionPromise = undefined;
      return connected;
    })
    .catch((error: unknown) => {
      connectionPromise = undefined;
      throw error;
    });

  return connectionPromise;
}

export async function closeNatsConnection(): Promise<void> {
  if (!connection) return;
  const current = connection;
  connection = undefined;
  await current.drain();
}
