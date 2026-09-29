"use client";

import { useRef, useState } from "react";
import { fromDataTransfer, fromInput } from "@/lib/uploads/intake";
import { useUploads } from "@/lib/uploads/provider";
import { StagedGroups } from "./upload-groups";
import { BatchControls, UploadList } from "./upload-list";

/**
 * Drop files or whole folders, check the guesses, press one button. Everything after that lives in
 * `UploadsProvider`, so this page can be left mid-batch — the activity bar
 * carries on showing it.
 */
export function UploadPanel() {
  const { add } = useUploads();
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const folderPicker = { webkitdirectory: "" } as Record<string, string>;

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
          void fromDataTransfer(event.dataTransfer.items).then((picked) => setNotice(add(picked)));
        }}
      >
        <p className="mb-4 font-display text-lg">Drop your game clips or folders here</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="button-primary" onClick={() => input.current?.click()}>
            Choose videos
          </button>
          <button type="button" className="button-secondary" onClick={() => folderInput.current?.click()}>
            Choose folder
          </button>
        </div>
        <input
          ref={input}
          type="file"
          multiple
          accept=".mp4,.mov,.mkv,.webm,.avi"
          className="hidden"
          aria-label="Choose videos"
          onChange={(event) => {
            setNotice(add(fromInput(event.target.files ?? [])));
            event.target.value = "";
          }}
        />
        <input
          ref={folderInput}
          type="file"
          multiple
          {...folderPicker}
          className="hidden"
          aria-label="Choose folder"
          onChange={(event) => {
            setNotice(add(fromInput(event.target.files ?? [])));
            event.target.value = "";
          }}
        />
        <p className="mt-4 text-sm text-ink-muted">MP4, MOV, MKV, WebM, or AVI</p>
      </div>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Uploads keep going while you look around the site. Closing the tab stops them; choose the
        same files again within 7 days to pick up where they left off.
      </p>
      {notice && (
        <p role="status" className="mt-4 text-ink-muted">
          {notice}
        </p>
      )}

      <StagedGroups />

      <section className="mt-8 flex flex-col gap-4">
        <div className="flex justify-end">
          <BatchControls />
        </div>
        <UploadList />
      </section>
    </>
  );
}
