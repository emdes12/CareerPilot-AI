import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { config } from './config.js';
import { runDiscovery } from './engine/discovery.js';

/** Optional BullMQ queue (enabled when REDIS_URL is set): durable jobs with retry/backoff. */
let queue: Queue | null = null;

export function initQueue() {
  if (!config.redisUrl || queue) return;
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  queue = new Queue('discovery', { connection });
  new Worker('discovery', async (job) => runDiscovery(job.data.userId, job.data.trigger, job.data.sources), { connection, concurrency: 1 });
  console.log('[queue] BullMQ discovery queue ready');
}

export async function queueDiscovery(userId: number, trigger: string, sources?: string[]) {
  initQueue();
  await queue!.add('run', { userId, trigger, sources }, { attempts: 3, backoff: { type: 'exponential', delay: 60000 }, removeOnComplete: 50, removeOnFail: 100 });
  return { queued: true, via: 'bullmq' };
}
