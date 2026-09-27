import { expect, test } from "bun:test";
import type { AdminJob } from "@/lib/realtime/envelope";
import { updateJobList } from "./job-list";

const job: AdminJob = { id: "j", clipId: "c", clipTitle: "clip", type: "probe", status: "queued", attempts: 0, lastError: null, createdAt: 0, startedAt: null, finishedAt: null };

test("a live status change removes a job from a filtered list", () => {
  expect(updateJobList([job], { ...job, status: "running" }, "queued", 100)).toEqual([]);
});

test("live updates insert matching jobs and replace existing rows", () => {
  expect(updateJobList([], job, "queued", 100)).toEqual([job]);
  expect(updateJobList([job], { ...job, attempts: 1 }, "", 100)).toEqual([{ ...job, attempts: 1 }]);
});

test("done jobs older than a day are excluded", () => {
  expect(updateJobList([job], { ...job, status: "done", finishedAt: 0 }, "", 86_400_001)).toEqual([]);
});
