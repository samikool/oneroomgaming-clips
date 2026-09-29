"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { IgdbGame } from "@/lib/igdb/api";
import { gameCover, pickerNotice, typedText, type Picked, type SearchState } from "@/lib/games/picker";
import type { LocalGame, PickerResults } from "@/lib/games/search";

type Option = { kind: "local"; game: LocalGame } | { kind: "igdb"; game: IgdbGame };

/** A game search box: your games first, then IGDB's. Arrow keys, Enter, Escape. */
export function GamePicker({
  initial, initialPick, igdbOnly = false, onPickLocal, onPickIgdb, onSubmitText, onTextChange, onBlurText, pending = false, label,
}: {
  initial: string;
  /** Set when `initial` names a real game rather than typed text. */
  initialPick?: Picked;
  igdbOnly?: boolean;
  onPickLocal?: (game: LocalGame) => void;
  onPickIgdb: (game: IgdbGame) => void;
  /** Enter on typed text, trimmed. Never called while the box holds a pick. */
  onSubmitText?: (text: string) => void;
  pending?: boolean;
  label: string;
  /** Every keystroke, for a caller that must know someone is typing. */
  onTextChange?: (text: string) => void;
  /** Leaving the box with typed text, trimmed. Never called while it holds a pick. */
  onBlurText?: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [results, setResults] = useState<PickerResults>({ local: [], igdb: [] });
  const [picked, setPicked] = useState<Picked | null>(initialPick ?? null);
  const [search, setSearch] = useState<SearchState>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  // The admin link opens on a known name, so it searches straight away; the clip box waits for typing.
  const typed = useRef(igdbOnly);

  // A late best guess lands in the box without remounting it, so focus and
  // anything typed survive. Once someone types, the box is theirs.
  const pickedCover = initialPick?.cover;
  const hasPick = initialPick !== undefined;
  useEffect(() => {
    if (typed.current) return;
    setText(initial);
    setPicked(hasPick ? { cover: pickedCover ?? null } : null);
  }, [initial, hasPick, pickedCover]);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 2) {
      setResults({ local: [], igdb: [] });
      setSearch("idle");
      return;
    }
    setSearch("searching");
    setOpen(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`search ${response.status}`);
        setResults((await response.json()) as PickerResults);
        setSearch("done");
        setActive(-1);
      } catch {
        // The next keystroke aborts this one; anything else is a real failure.
        if (!controller.signal.aborted) setSearch("failed");
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const options: Option[] = [
    ...(igdbOnly ? [] : results.local.map((game) => ({ kind: "local" as const, game }))),
    ...results.igdb.map((game) => ({ kind: "igdb" as const, game })),
  ];

  function pick(option: Option) {
    setOpen(false);
    setSearch("idle");
    setText(option.game.name);
    setPicked({ cover: gameCover(option.game) });
    typed.current = false;
    if (option.kind === "local") onPickLocal?.(option.game);
    else onPickIgdb(option.game);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === "Escape" && open) {
      // Only this list closes: not a dialog around it, not select mode.
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && active >= 0 && options[active]) {
        pick(options[active]);
      } else {
        setOpen(false);
        const typed = typedText(text, picked);
        if (typed !== null) onSubmitText?.(typed);
      }
    }
  }

  const localCount = igdbOnly ? 0 : results.local.length;
  const notice = pickerNotice({ search, query: text.trim(), count: options.length, igdbOnly });
  const cover = picked?.cover;

  return (
    <div className="game-picker">
      <div className="metadata-row">
        <div className="game-picker-box">
          {cover && <img src={cover} alt="" className="game-picker-cover" />}
          <input
            className={cover ? "title-input has-cover" : "title-input"}
            role="combobox"
            aria-label={label}
            aria-expanded={open && (options.length > 0 || notice !== null)}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            value={text}
            disabled={pending}
            placeholder="Valorant"
            onChange={(event) => {
              typed.current = true;
              setPicked(null);
              setText(event.target.value);
              onTextChange?.(event.target.value);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setTimeout(() => setOpen(false), 150);
              const typed = typedText(text, picked);
              if (typed !== null) onBlurText?.(typed);
            }}
            onFocus={() => options.length > 0 && setOpen(true)}
          />
        </div>
      </div>
      {!igdbOnly && !open && !picked && text.trim() && (
        <p className="game-picker-hint">New game, not on IGDB</p>
      )}
      {open && (options.length > 0 || notice) && (
        <ul id={listId} role="listbox" className="game-picker-list">
          {options.map((option, index) => {
            const heading =
              index === 0 && localCount > 0 ? "Your games" : index === localCount ? "From IGDB" : null;
            const art = gameCover(option.game);
            return (
              <li key={`${option.kind}-${option.kind === "local" ? option.game.id : option.game.igdbId}`} role="presentation">
                {heading && <div className="game-picker-heading">{heading}</div>}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className="game-picker-option"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(option);
                  }}
                >
                  {art ? <img src={art} alt="" className="game-cover-sm" /> : <span className="game-cover-sm" />}
                  <span>{option.game.name}</span>
                  {option.kind === "igdb" && option.game.year && (
                    <span className="text-ink-muted"> · {option.game.year}</span>
                  )}
                </div>
              </li>
            );
          })}
          {notice && (
            <li role="presentation" className="game-picker-notice" aria-live="polite">
              {notice}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
