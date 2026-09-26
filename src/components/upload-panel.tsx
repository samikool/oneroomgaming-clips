"use client";

import { useRef, useState } from "react";
import { useUploads } from "@/lib/uploads/provider";
import { BatchControls, UploadList } from "./upload-list";

/**
 * Drop files, fix titles, press one button. Everything after that lives in
 * `UploadsProvider`, so this page can be left mid-batch — the activity bar
 * carries on showing it.
 */
export function UploadPanel() {
  const { batch, add, setTitle, cancel, start } = useUploads();
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const staged = batch.items.filter((i) => i.phase === "staged");

  function take(files: File[]): void {
    setError(add(files));
  }

  return (
    <>
      <div
        className={`drop-area ${dragging ? "drop-active" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          take(Array.from(event.dataTransfer.files));
        }}
      >
        <p className="mb-4 font-display text-lg">Drop your game clips here</p>
        <button type="button" className="button-primary" onClick={() => input.current?.click()}>
          Choose videos
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp4,.mov,.mkv,.webm,.avi"
          className="hidden"
          aria-label="Choose videos"
          onChange={(event) => {
            take(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <p className="mt-4 text-sm text-ink-muted">MP4, MOV, MKV, WebM, or AVI</p>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Uploads keep going while you look around the site. Closing the tab stops them; choose the
        same files again within 7 days to pick up where they left off.
      </p>
      {error && (
        <p role="alert" className="mt-4 text-danger">
          {error}
        </p>
      )}

      {staged.length > 0 && (
        <section className="mt-8" aria-label="Ready to upload">
          <div className="mb-4 flex justify-end">
            <button type="button" className="button-primary" onClick={start}>
              Upload {staged.length} clip{staged.length === 1 ? "" : "s"}
            </button>
          </div>
          <ul className="flex flex-col gap-3">
            {staged.map((item) => (
              <li key={item.key} className="staged-item">
                <div className="min-w-0 flex-1">
                  <label htmlFor={`title-${item.key}`} className="mb-1 block truncate text-xs text-ink-muted">
                    {item.name}
                  </label>
                  <input
                    id={`title-${item.key}`}
                    className="title-input"
                    value={item.title}
                    maxLength={200}
                    autoComplete="off"
                    onChange={(event) => setTitle(item.key, event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="queue-action"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => cancel(item.key)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 flex flex-col gap-4">
        <div className="flex justify-end">
          <BatchControls />
        </div>
        <UploadList />
      </section>
    </>
  );
}
