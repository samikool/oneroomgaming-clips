import type { AdminJob } from "@/lib/realtime/envelope";

/** Keep the selected filter true as jobs advance through the pipeline. */
export function updateJobList(current: AdminJob[], job: AdminJob, status: string, now: number): AdminJob[] {
  const matches = (!status || job.status === status) &&
    (job.status !== "done" || (job.finishedAt !== null && job.finishedAt >= now - 86_400_000));
  if (!matches) return current.filter((row) => row.id !== job.id);
  return current.some((row) => row.id === job.id)
    ? current.map((row) => row.id === job.id ? job : row)
    : [job, ...current].slice(0, 200);
}
