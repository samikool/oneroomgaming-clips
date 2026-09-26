"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Upload } from "tus-js-client";
import { useRealtime } from "@/lib/realtime/use-realtime";
import * as rules from "./batch";
import type { Batch, BatchItem } from "./batch";

type Uploads = {
  batch: Batch;
  /** Returns an error message when some files were refused. */
  add(files: File[]): string;
  setTitle(key: string, title: string): void;
  start(): void;
  pauseAll(): void;
  resumeAll(): void;
  retry(key: string): void;
  /** Removes a staged file, or stops one that is queued or sending. */
  cancel(key: string): void;
  cancelAll(): void;
  clearFinished(): void;
};

const UploadsContext = createContext<Uploads | null>(null);

const ACCEPTED = /\.(mp4|mov|mkv|webm|avi)$/i;
const keyOf = (file: File) => `${file.name}-${file.size}-${file.lastModified}`;

/**
 * Owns every upload for the tab, above the pages, so moving around the site
 * never unmounts one — which is how leaving the upload page used to cancel
 * them. The rules live in `./batch`; this only drives tus and the socket.
 */
export function UploadsProvider({ me, children }: { me: string; children: React.ReactNode }) {
  const [batch, setBatch] = useState<Batch>(rules.EMPTY_BATCH);
  // Refs, not state, for everything the tus callbacks read: they fire long
  // after the render that created them.
  const batchRef = useRef<Batch>(rules.EMPTY_BATCH);
  const files = useRef(new Map<string, File>());
  const uploads = useRef(new Map<string, Upload>());

  const commit = useCallback((next: Batch) => {
    batchRef.current = next;
    setBatch(next);
    pumpRef.current();
  }, []);

  const patch = useCallback(
    (key: string, change: Partial<BatchItem>) => commit(rules.updateItem(batchRef.current, key, change)),
    [commit],
  );

  const phaseOf = (key: string) => batchRef.current.items.find((i) => i.key === key)?.phase;

  async function send(key: string): Promise<void> {
    const file = files.current.get(key);
    const item = batchRef.current.items.find((i) => i.key === key);

    if (!file || !item) {
      return;
    }

    patch(key, { phase: "starting", message: undefined });

    try {
      let task = uploads.current.get(key);

      if (!task) {
        const { Upload } = await import("tus-js-client");
        task = new Upload(file, {
          endpoint: "/api/uploads",
          chunkSize: 16 * 1024 * 1024,
          retryDelays: [0, 1000, 3000, 5000, 10000],
          removeFingerprintOnSuccess: true,
          metadata: { filename: file.name, title: item.title.trim() || file.name.replace(/\.[^.]+$/, "") },
          fingerprint: async () =>
            JSON.stringify(["clips-upload-v1", me, file.name, file.size, file.lastModified, file.type]),
          onProgress: (sent) => patch(key, { sent }),
          onError: (err) => {
            // A pause or cancel aborts on purpose; that is not a failure.
            if (["pausing", "paused", "cancelled"].includes(phaseOf(key) ?? "")) {
              return;
            }

            const status = "originalResponse" in err ? err.originalResponse?.getStatus() : undefined;
            patch(key, {
              phase: "error",
              message:
                status === 401 || status === 403
                  ? "Sign in again, then retry."
                  : "The upload stopped. Retry to continue from the last saved chunk.",
            });
          },
          onSuccess: () => {
            const created = uploads.current.get(key);
            patch(key, {
              phase: "processing",
              sent: file.size,
              clipId: created?.url ? new URL(created.url, location.href).pathname.split("/").at(-1) : undefined,
            });
          },
        });
        uploads.current.set(key, task);

        const previous = await task.findPreviousUploads();

        if (previous.length) {
          task.resumeFromPreviousUpload(previous[0]);
        }
      }

      // Paused or cancelled while tus was loading.
      if (phaseOf(key) !== "starting") {
        return;
      }

      patch(key, { phase: "uploading" });
      task.start();
    } catch {
      patch(key, { phase: "error", message: "Could not start the upload. Check your connection and retry." });
    }
  }

  const pumpRef = useRef<() => void>(() => {});
  pumpRef.current = () => {
    const key = rules.nextToSend(batchRef.current);

    if (key) {
      void send(key);
    }
  };

  // Processing status arrives pushed; "failed" is only sent once the server's
  // own retries are spent, so it is final.
  useRealtime(["grid"], (message) => {
    if (message.t !== "clip.updated") {
      return;
    }

    const item = batchRef.current.items.find((i) => i.clipId === message.clip.id);
    const status = message.clip.status;

    if (item && (status === "ready" || status === "failed" || status === "needs_transcode")) {
      patch(item.key, { phase: status });
    }
  });

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (rules.isActive(batchRef.current)) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const value = useMemo<Uploads>(() => {
    async function stop(key: string, terminate: boolean): Promise<void> {
      const task = uploads.current.get(key);

      try {
        await task?.abort(terminate);
      } catch {
        // Already gone; the phase below is still the truth.
      }

      if (terminate) {
        uploads.current.delete(key);
        files.current.delete(key);
      }
    }

    return {
      batch,
      add(selected) {
        const valid = selected.filter((f) => ACCEPTED.test(f.name) && f.size > 0);

        for (const f of valid) {
          if (!files.current.has(keyOf(f))) {
            files.current.set(keyOf(f), f);
          }
        }

        commit(
          rules.addFiles(
            batchRef.current,
            valid.map((f) => ({ key: keyOf(f), name: f.name, size: f.size })),
          ),
        );

        return valid.length < selected.length ? "Choose non-empty MP4, MOV, MKV, WebM, or AVI videos." : "";
      },
      setTitle(key, title) {
        patch(key, { title: title.slice(0, 200) });
      },
      start() {
        commit(rules.startBatch(batchRef.current));
      },
      pauseAll() {
        const sending = batchRef.current.items.find((i) =>
          ["starting", "uploading"].includes(i.phase),
        );
        commit(rules.pauseAll(batchRef.current));

        if (sending) {
          patch(sending.key, { phase: "pausing" });
          void stop(sending.key, false).then(() => patch(sending.key, { phase: "paused" }));
        }
      },
      resumeAll() {
        commit(rules.resumeAll(batchRef.current));
      },
      retry(key) {
        commit(rules.retry(batchRef.current, key));
      },
      cancel(key) {
        if (phaseOf(key) === "staged") {
          files.current.delete(key);
          commit(rules.removeStaged(batchRef.current, key));
          return;
        }

        patch(key, { phase: "cancelled" });
        void stop(key, true);
      },
      cancelAll() {
        const live = batchRef.current.items.filter((i) => uploads.current.has(i.key));
        commit(rules.cancelAll(batchRef.current));

        for (const item of live) {
          if (!["processing", "ready", "failed", "needs_transcode"].includes(item.phase)) {
            void stop(item.key, true);
          }
        }
      },
      clearFinished() {
        commit(rules.clearFinished(batchRef.current));
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch, commit, patch]);

  return <UploadsContext.Provider value={value}>{children}</UploadsContext.Provider>;
}

export function useUploads(): Uploads {
  const context = useContext(UploadsContext);

  if (!context) {
    throw new Error("useUploads must be used inside UploadsProvider");
  }

  return context;
}
