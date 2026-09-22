import type { Db } from "@/db/client";
import type { Job } from "@/db/schema";

export type JobContext = {
  db: Db;
  env: NodeJS.ProcessEnv;
};

export type JobHandler = (ctx: JobContext, job: Job) => Promise<void>;
