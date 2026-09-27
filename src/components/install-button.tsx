"use client";

import { useEffect, useRef, useState } from "react";
import { installMode, isIos } from "@/lib/pwa/install";

/** Chromium's install prompt event; not in the DOM typings. */
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * "Install app" in the header, for everyone. Chromium hands over a prompt to
 * trigger; iOS has none, so it gets a hint. Hidden once installed, and on
 * any browser that offers no way to install.
 */
export function InstallButton({ menuItem = false }: { menuItem?: boolean }) {
  const buttonClass = menuItem ? "header-menu-item w-full" : "nav-link text-sm";
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true); // Hidden until the browser has been asked.
  const [ios, setIos] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const media = matchMedia("(display-mode: standalone)");
    const sync = () =>
      setStandalone(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    sync();
    setIos(isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    media.addEventListener("change", sync);

    const onPrompt = (event: Event) => {
      // Keep it for our own button rather than the browser's mini-infobar.
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    // Chromium can fire the event before hydration; the layout's inline
    // script (EARLY_PROMPT_SCRIPT) keeps it for us.
    const early = (window as Window & { __installPrompt?: InstallPromptEvent }).__installPrompt;
    if (early) setPrompt(early);
    const onInstalled = () => {
      (window as Window & { __installPrompt?: InstallPromptEvent }).__installPrompt = undefined;
      setPrompt(null);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!hintOpen) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !wrap.current?.contains(event.target as Node)) {
        setHintOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [hintOpen]);

  const mode = installMode({ standalone, hasPrompt: prompt !== null, ios });

  if (mode === "hidden") {
    return null;
  }

  if (mode === "prompt") {
    return (
      <button
        type="button"
        className={buttonClass}
        onClick={async () => {
          const event = prompt!;
          await event.prompt();
          // A prompt can be used once, whatever the answer.
          (window as Window & { __installPrompt?: InstallPromptEvent }).__installPrompt = undefined;
          setPrompt(null);
        }}
      >
        Install app
      </button>
    );
  }

  return (
    <span ref={wrap} className="relative">
      <button type="button" className={buttonClass} aria-expanded={hintOpen} onClick={() => setHintOpen((open) => !open)}>
        Install app
      </button>
      {hintOpen && (
        <span
          role="dialog"
          aria-label="Install on iPhone"
          className="absolute right-0 top-full z-50 mt-2 block w-56 rounded-md border border-brand bg-surface-raised p-3 text-sm text-ink shadow-[4px_4px_0_var(--color-surface-sunken)]"
        >
          Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
      )}
    </span>
  );
}
