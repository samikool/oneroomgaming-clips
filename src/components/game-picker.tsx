"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { IgdbGame } from "@/lib/igdb/api";
import type { LocalGame, PickerResults } from "@/lib/games/search";
import { coverPublicPath } from "@/lib/media/paths";

type Option = { kind: "local"; game: LocalGame } | { kind: "igdb"; game: IgdbGame };

const IGDB_THUMB = (id: string) => `https://images.igdb.com/igdb/image/upload/t_thumb/${id}.jpg`;

/** A game search box: your games first, then IGDB's. Arrow keys, Enter, Escape. */
export function GamePicker({
  initial, igdbOnly = false, onPickLocal, onPickIgdb, onSubmitText, onTextChange, onBlurText, pending = false, label,
}: {
  initial: string;
  igdbOnly?: boolean;
  onPickLocal?: (game: LocalGame) => void;
  onPickIgdb: (game: IgdbGame) => void;
  onSubmitText?: (text: string) => void;
  pending?: boolean;
  label: string;
  /** Every keystroke, for a caller that must know someone is typing. */
  onTextChange?: (text: string) => void;
  /** Leaving the box, with whatever it holds. */
  onBlurText?: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  const [results, setResults] = useState<PickerResults>({ local: [], igdb: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  // The admin link opens on a known name, so it searches straight away; the clip box waits for typing.
  const typed = useRef(igdbOnly);

  useEffect(() => {
    if (!typed.current) return;
    const q = text.trim();
    if (q.length < 2) {
      setResults({ local: [], igdb: [] });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/games/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (response.ok) {
          setResults((await response.json()) as PickerResults);
          setOpen(true);
          setActive(-1);
        }
      } catch {
        // Aborted by the next keystroke, or offline: keep whatever is showing.
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
    setText(option.game.name);
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
    } else if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && active >= 0 && options[active]) pick(options[active]);
      else onSubmitText?.(text);
    }
  }

  const localCount = igdbOnly ? 0 : results.local.length;

  return (
    <div className="game-picker">
      <div className="metadata-row">
        <input
          className="title-input"
          role="combobox"
          aria-label={label}
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          value={text}
          disabled={pending}
          placeholder="Valorant"
          onChange={(event) => {
            typed.current = true;
            setText(event.target.value);
            onTextChange?.(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setTimeout(() => setOpen(false), 150);
            onBlurText?.(text);
          }}
          onFocus={() => options.length > 0 && setOpen(true)}
        />
        {onSubmitText && (
          <button type="button" className="button-secondary" disabled={pending} onClick={() => onSubmitText(text)}>
            Save
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul id={listId} role="listbox" className="game-picker-list">
          {options.map((option, index) => {
            const heading =
              index === 0 && localCount > 0 ? "Your games" : index === localCount ? "From IGDB" : null;
            const cover =
              option.kind === "local"
                ? option.game.coverPath && coverPublicPath(option.game.coverPath)
                : option.game.coverImageId && IGDB_THUMB(option.game.coverImageId);
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
                  {cover ? <img src={cover} alt="" className="game-cover-sm" /> : <span className="game-cover-sm" />}
                  <span>{option.game.name}</span>
                  {option.kind === "igdb" && option.game.year && (
                    <span className="text-ink-muted"> · {option.game.year}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
