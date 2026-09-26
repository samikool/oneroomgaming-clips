"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { navIndex, tabsBetween } from "@/lib/nav";

/** Time for the strip to move one screen: one panel passing by. */
const PANEL_MS = 160;
/** Give up and show the page if navigation has not landed by then. */
const SAFETY_MS = 5_000;
/** Soft landing for the last panel, so the new page settles rather than stops. */
const SETTLE = "cubic-bezier(0.16, 1, 0.3, 1)";

type Run = {
  id: number;
  to: number;
  /** +1 heading right (the strip moves left), -1 heading left. */
  direction: 1 | -1;
  cards: string[];
  snapshot: HTMLElement;
  /** Where the old page sat relative to the top of the strip. */
  offsetY: number;
  top: number;
  startedAt: number;
};

type Slide = {
  run: Run | null;
  start(href: string): void;
  register(node: HTMLDivElement | null): void;
  pageArrived(id: number): void;
};

const SlideContext = createContext<Slide | null>(null);

/**
 * A filmstrip between header tabs: the page you are leaving slides away, the
 * tabs in between pass as title cards, and the new page slides in last. The
 * in-between pages are never loaded — opening the theater off-screen would
 * join the room — so they are cards, not pages.
 *
 * Only header clicks start it (see `SiteHeader`). Everything else — a clip,
 * a filter, back and forward — just switches.
 */
export function SlideProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [run, setRun] = useState<Run | null>(null);
  const page = useRef<HTMLDivElement | null>(null);
  const done = useRef({ strip: false, page: false });
  const nextId = useRef(1);

  const finish = useCallback((id: number) => {
    setRun((current) => (current?.id === id ? null : current));
  }, []);

  const settle = useCallback(
    (id: number, part: "strip" | "page") => {
      done.current[part] = true;

      if (done.current.strip && done.current.page) {
        finish(id);
      }
    },
    [finish],
  );

  const start = useCallback(
    (href: string) => {
      const from = navIndex(pathname);
      const to = navIndex(new URL(href, location.href).pathname);
      const node = page.current;

      if (from === null || to === null || from === to || !node) {
        return;
      }

      if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }

      const header = document.querySelector(".site-header");
      const top = Math.max(0, header?.getBoundingClientRect().bottom ?? 0);
      const snapshot = node.cloneNode(true) as HTMLElement;

      // A picture of the page, not a second copy of it: a cloned video would
      // start downloading the clip again.
      for (const video of snapshot.querySelectorAll("video")) {
        video.removeAttribute("src");
        video.preload = "none";
      }
      const id = nextId.current++;

      done.current = { strip: false, page: false };
      setRun({
        id,
        to,
        direction: to > from ? 1 : -1,
        cards: tabsBetween(from, to),
        snapshot,
        offsetY: node.getBoundingClientRect().top - top,
        top,
        startedAt: performance.now(),
      });
      setTimeout(() => finish(id), SAFETY_MS);
    },
    [pathname, finish],
  );

  const register = useCallback((node: HTMLDivElement | null) => {
    page.current = node;
  }, []);

  const pageArrived = useCallback((id: number) => settle(id, "page"), [settle]);

  return (
    <SlideContext.Provider value={{ run, start, register, pageArrived }}>
      {children}
      {run && <Strip key={run.id} run={run} onDone={() => settle(run.id, "strip")} />}
    </SlideContext.Provider>
  );
}

export function useSlide(): Slide | null {
  return useContext(SlideContext);
}

/** The overlay: the old page followed by one title card per tab passed. */
function Strip({ run, onDone }: { run: Run; onDone(): void }) {
  const strip = useRef<HTMLDivElement>(null);
  const oldSlot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const slot = oldSlot.current;
    const node = strip.current;

    if (!slot || !node) {
      return;
    }

    slot.appendChild(run.snapshot);

    // Panels travel off in the direction of motion; the strip covers one
    // screen per panel, and the last stretch eases so it hands over softly to
    // the incoming page, which runs the same curve over the same stretch.
    const panels = run.cards.length + 1;
    const distance = -run.direction * panels * 100;
    const handover = (panels - 1) / panels;
    const animation = node.animate(
      [
        { transform: "translateX(0)", easing: "linear" },
        { transform: `translateX(${-run.direction * (panels - 1) * 100}vw)`, offset: handover, easing: SETTLE },
        { transform: `translateX(${distance}vw)` },
      ],
      { duration: panels * PANEL_MS, fill: "forwards" },
    );
    animation.onfinish = onDone;

    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="slide-overlay" style={{ top: run.top }} aria-hidden="true">
      <div ref={strip} className={`slide-strip${run.direction === -1 ? " slide-strip-reverse" : ""}`}>
        <div className="slide-panel slide-panel-old">
          <div ref={oldSlot} style={{ transform: `translateY(${run.offsetY}px)` }} />
        </div>
        {run.cards.map((label) => (
          <div key={label} className="slide-panel slide-card">
            <span className="slide-card-label">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Wraps the current page. Hidden while a strip is running and the page has
 * not arrived yet (so the old page never peeks out behind the strip), then
 * slides in on the strip's last stretch.
 */
export function PageSlide({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const slide = useSlide();
  const node = useRef<HTMLDivElement>(null);
  const run = slide?.run ?? null;
  const arrived = run !== null && navIndex(pathname) === run.to;

  useEffect(() => {
    slide?.register(node.current);
  });

  useLayoutEffect(() => {
    const el = node.current;

    if (!run || !arrived || !el) {
      return;
    }

    const panels = run.cards.length + 1;
    const elapsed = performance.now() - run.startedAt;
    const delay = Math.max(0, (panels - 1) * PANEL_MS - elapsed);
    const animation = el.animate(
      [{ transform: `translateX(${run.direction * 100}vw)` }, { transform: "translateX(0)" }],
      { duration: PANEL_MS, delay, easing: SETTLE, fill: "backwards" },
    );
    animation.onfinish = () => slide?.pageArrived(run.id);

    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrived, run?.id]);

  return (
    <div
      key={pathname}
      ref={node}
      className="page-slide"
      style={run && !arrived ? { visibility: "hidden" } : undefined}
    >
      {children}
    </div>
  );
}
