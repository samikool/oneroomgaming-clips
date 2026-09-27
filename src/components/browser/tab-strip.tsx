"use client";

import { Children, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { SORTS, type Sort } from "@/lib/browse/query";
import { swipeResult } from "@/lib/browse/swipe";
import { PANEL_MS, SETTLE } from "../page-slide";
import { panelId, tabId } from "./browse-bar";

/**
 * The four tabs side by side; the strip slides to the active one with the
 * header's page-slide timing. The frame takes the active panel's height, so a
 * short tab never leaves a long empty scroll, and each tab keeps its own
 * scroll position.
 *
 * Children are one panel per sort, in `SORTS` order.
 */
export function TabStrip({ active, onChange, children }: { active: Sort; onChange(sort: Sort): void; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const shown = useRef<number | null>(null);
  const scrolls = useRef<Partial<Record<Sort, number>>>({});
  const slide = useRef<Animation | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const index = SORTS.indexOf(active);

  useLayoutEffect(() => {
    const el = strip.current;
    const box = frame.current;
    const from = shown.current;
    shown.current = index;

    if (!el || !box) return;

    const end = `translateX(${-index * 100}%)`;

    if (from === null || from === index) {
      el.style.transform = end;
      return;
    }

    // Where each tab was left, and where this one should come back to. A tab
    // not visited yet opens at its top: the grid's first row under the bar,
    // not the top of the page.
    const leftAt = window.scrollY;
    scrolls.current[SORTS[from]] = leftAt;
    const barHeight = document.querySelector(".browse-bar")?.getBoundingClientRect().height ?? 0;
    const tabTop = box.getBoundingClientRect().top + window.scrollY - barHeight;
    const goTo = scrolls.current[active] ?? Math.min(leftAt, Math.max(0, tabTop));

    const incoming = panels.current[index];
    if (incoming) box.style.height = `${incoming.offsetHeight}px`;
    window.scrollTo({ top: goTo, behavior: "instant" });

    slide.current?.cancel();
    el.style.transform = end;

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The page just scrolled under the leaving panel; hold it where the eye
    // last saw it while it slides away.
    const outgoing = panels.current[from];
    const shift = window.scrollY - leftAt;
    if (outgoing && shift !== 0) outgoing.style.transform = `translateY(${shift}px)`;

    const animation = el.animate([{ transform: `translateX(${-from * 100}%)` }, { transform: end }], {
      duration: Math.abs(index - from) * PANEL_MS,
      easing: SETTLE,
    });
    const settle = () => {
      if (outgoing) outgoing.style.transform = "";
    };
    animation.onfinish = settle;
    animation.oncancel = settle;
    slide.current = animation;
  }, [index, active]);

  // The frame follows the active panel as it grows (another page loaded) or shrinks.
  useEffect(() => {
    const panel = panels.current[index];
    const box = frame.current;
    if (!panel || !box) return;

    const observer = new ResizeObserver(() => {
      box.style.height = `${panel.offsetHeight}px`;
    });
    observer.observe(panel);

    return () => observer.disconnect();
  }, [index]);

  return (
    <div
      ref={frame}
      className="tab-strip-frame"
      onPointerDown={(event) => {
        // A mouse drag is text selection; swiping is for fingers and pens.
        start.current = event.pointerType === "mouse" ? null : { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const from = start.current;
        start.current = null;
        if (!from) return;

        const next = swipeResult(event.clientX - from.x, event.clientY - from.y, index, SORTS.length);
        if (next !== index) onChange(SORTS[next]);
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <div ref={strip} className="tab-strip">
        {Children.toArray(children).map((child, i) => (
          <div
            key={SORTS[i]}
            ref={(node) => {
              panels.current[i] = node;
            }}
            id={panelId(SORTS[i])}
            role="tabpanel"
            aria-labelledby={tabId(SORTS[i])}
            className="tab-panel"
            inert={i !== index}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
