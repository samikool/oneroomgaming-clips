"use client";
import { useState } from "react";
export function ClipPlayer({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return <>
    <video className="w-full rounded-lg bg-black" src={src} controls preload="metadata" playsInline
      onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)} />
    {failed && <p role="alert" className="mt-4 text-rose-300">This video could not be loaded. Try refreshing the page, or ask the uploader to check the file.</p>}
  </>;
}
