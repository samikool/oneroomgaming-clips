"use client";

import { useEffect, useRef, useState } from "react";
import { clampOffset, coverCrop } from "@/lib/profiles/crop";

const PREVIEW = 240;
const ZOOM_MAX = 4;

/** A picked image and how it is framed. Offsets are in source pixels from centre. */
export type PendingPicture = {
  bitmap: ImageBitmap;
  zoom: number;
  x: number;
  y: number;
};

export class WebpUnsupportedError extends Error {
  constructor() {
    super("Your browser can't make WebP images — try Chrome or Firefox.");
    this.name = "WebpUnsupportedError";
  }
}

function drawCrop(canvas: HTMLCanvasElement, picture: PendingPicture, size: number): void {
  const { bitmap, zoom, x, y } = picture;
  const { sx, sy, sSize } = coverCrop(bitmap.width, bitmap.height, zoom, x, y);
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(bitmap, sx, sy, sSize, sSize, 0, 0, size, size);
}

function toWebp(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // A browser that can't encode WebP quietly hands back a PNG instead.
        if (!blob || blob.type !== "image/webp") {
          reject(new WebpUnsupportedError());
          return;
        }
        resolve(blob);
      },
      "image/webp",
      0.85,
    );
  });
}

/** The framed square at both stored sizes, as WebP. */
export async function exportPicture(picture: PendingPicture): Promise<{ s256: Blob; s64: Blob }> {
  const render = (size: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    drawCrop(canvas, picture, size);
    return toWebp(canvas);
  };

  const [s256, s64] = await Promise.all([render(256), render(64)]);
  return { s256, s64 };
}

/**
 * Pick an image, then drag to frame it and slide to zoom. Everything happens
 * in the browser: the server only ever receives the two finished squares.
 */
export function PictureCropper({
  value,
  onChange,
}: {
  value: PendingPicture | null;
  onChange(picture: PendingPicture | null): void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value && canvasRef.current) {
      drawCrop(canvasRef.current, value, PREVIEW);
    }
  }, [value]);

  async function pick(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    try {
      // A GIF decodes to its first frame, which is what an avatar wants.
      const bitmap = await createImageBitmap(file);
      setError(null);
      onChange({ bitmap, zoom: 1, x: 0, y: 0 });
    } catch {
      setError("That file isn't an image this browser can open.");
    }
  }

  function reframe(next: PendingPicture): void {
    const { x, y } = clampOffset(next.bitmap.width, next.bitmap.height, next.zoom, next.x, next.y);
    onChange({ ...next, x, y });
  }

  return (
    <div className="picture-cropper">
      <label className="button-secondary cursor-pointer">
        {value ? "Upload another image" : "Upload image"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            void pick(event.target.files?.[0]);
            // Picking the same file again should still fire.
            event.target.value = "";
          }}
        />
      </label>

      {error && <p className="text-xs text-danger">{error}</p>}

      {value && (
        <>
          <canvas
            ref={canvasRef}
            width={PREVIEW}
            height={PREVIEW}
            className="picture-cropper-canvas"
            aria-label="Drag to frame your picture"
            onPointerDown={(event) => {
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { pointerX: event.clientX, pointerY: event.clientY };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;

              if (!drag) {
                return;
              }

              // Screen pixels to source pixels. Inverted: dragging the picture
              // right moves the frame left across the source.
              const { sSize } = coverCrop(value.bitmap.width, value.bitmap.height, value.zoom, 0, 0);
              const scale = sSize / event.currentTarget.getBoundingClientRect().width;
              reframe({
                ...value,
                x: value.x - (event.clientX - drag.pointerX) * scale,
                y: value.y - (event.clientY - drag.pointerY) * scale,
              });
              dragRef.current = { pointerX: event.clientX, pointerY: event.clientY };
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          />
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            Zoom
            <input
              type="range"
              min={1}
              max={ZOOM_MAX}
              step={0.01}
              value={value.zoom}
              onChange={(event) => reframe({ ...value, zoom: Number(event.target.value) })}
            />
          </label>
        </>
      )}
    </div>
  );
}
