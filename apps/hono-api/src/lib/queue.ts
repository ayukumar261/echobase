import { Redis } from "ioredis";
import { Queue } from "bullmq";

const url = process.env.REDIS_URL;
if (!url) throw new Error("REDIS_URL is not set");

export const redisConnection = new Redis(url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  // Fail individual commands fast when Redis is unreachable so the API can
  // surface a 503 instead of hanging while ioredis silently buffers commands.
  commandTimeout: 2000,
});

export const TASKS_QUEUE_NAME = "tasks" as const;

export const tasksQueue = new Queue(TASKS_QUEUE_NAME, {
  connection: redisConnection,
});
