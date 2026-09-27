"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { cancelJobAction, retryJobAction } from "@/app/admin/actions";
import type { AdminJob } from "@/lib/realtime/envelope";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { updateJobList } from "@/lib/admin/job-list";
import { When } from "./when";

const FILTERS = [
  { value: "", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "failed", label: "Failed" },
  { value: "done", label: "Done (24h)" },
] as const;

/**
 * The job queue. Rows update in place from `job.updated`; a job the page
 * hadn't seen yet (a stage the pipeline just queued) joins at the top when it
 * first changes status.
 */
export function JobsPanel({ jobs: initial, status }: { jobs: AdminJob[]; status: string }) {
  const [jobs, setJobs] = useState(initial);
  useEffect(() => setJobs(initial), [initial]);

  useRealtime(["grid"], (message) => {
    if (message.t !== "job.updated") {
      return;
    }

    const { job } = message;
    setJobs((current) => updateJobList(current, job, status, Date.now()));
  });

  return (
    <div>
      <nav className="admin-toolbar" aria-label="Job status">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={filter.value ? `/admin?s=jobs&status=${filter.value}` : "/admin?s=jobs"}
            aria-current={status === filter.value ? "page" : undefined}
            className={`admin-small-button${status === filter.value ? " text-brand" : ""}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="text-sm text-ink-muted">No jobs.</p>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Clip</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Last error</th>
                <th>Created</th>
                <th>Started</th>
                <th>Finished</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: AdminJob }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>) {
    startTransition(async () => {
      const result = await action(job.id);
      setMessage(result.ok ? null : result.error);
    });
  }

  return (
    <tr>
      <td className="font-pixel text-[11px]">{job.type}</td>
      <td className="max-w-[14rem] truncate">
        {job.clipTitle === null ? (
          <span className="text-ink-muted">deleted</span>
        ) : (
          <Link href={`/clips/${job.clipId}`} className="underline decoration-line-strong hover:text-brand">
            {job.clipTitle}
          </Link>
        )}
      </td>
      <td>
        <span className={`admin-status admin-status-${job.status}`}>{job.status}</span>
      </td>
      <td className="font-pixel text-[11px]">{job.attempts}</td>
      <td className="max-w-[18rem]">
        {job.lastError ? <span className="admin-error">{job.lastError}</span> : <span className="text-ink-muted">—</span>}
        {message && <span className="admin-message block">{message}</span>}
      </td>
      <td className="whitespace-nowrap"><When at={job.createdAt} /></td>
      <td className="whitespace-nowrap"><When at={job.startedAt} /></td>
      <td className="whitespace-nowrap"><When at={job.finishedAt} /></td>
      <td>
        {job.status === "failed" && (
          <button type="button" className="admin-small-button" disabled={pending} onClick={() => run(retryJobAction)}>
            Retry
          </button>
        )}
        {job.status === "queued" && (
          <button type="button" className="admin-small-button admin-small-danger" disabled={pending} onClick={() => run(cancelJobAction)}>
            Cancel
          </button>
        )}
      </td>
    </tr>
  );
}
