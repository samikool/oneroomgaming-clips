"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";

export type FilterItem = {
  value: string;
  /** What filter-as-you-type matches against. */
  text: string;
  /** What the row shows; the text when absent. */
  display?: ReactNode;
};

/**
 * A button that opens a checkbox list under it. Escape closes it and puts
 * focus back on the button; a click anywhere else closes it and leaves focus
 * where that click put it.
 */
export function FilterPopover({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: FilterItem[];
  selected: string[];
  onToggle(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const anchor = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setFilter("");
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    input.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const needle = filter.trim().toLowerCase();
  const shown = needle ? items.filter((item) => item.text.toLowerCase().includes(needle)) : items;

  return (
    <div ref={anchor} className="filter-popover-anchor">
      <button
        ref={button}
        type="button"
        className={`browse-filter-button${selected.length > 0 ? " browse-filter-button-on" : ""}`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {label}
        {selected.length > 0 && <span className="browse-filter-count font-pixel">{selected.length}</span>}
        <span aria-hidden="true" className="browse-filter-caret">▾</span>
      </button>

      {open && (
        <div id={id} className="filter-popover" role="dialog" aria-label={`Filter by ${label.toLowerCase()}`}>
          <input
            ref={input}
            type="search"
            className="filter-popover-input"
            placeholder={`Find a ${label.toLowerCase()}…`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <ul className="filter-popover-list">
            {shown.length === 0 && <li className="filter-popover-empty">Nothing here.</li>}
            {shown.map((item) => (
              <li key={item.value}>
                <label className="filter-option">
                  <input type="checkbox" checked={selected.includes(item.value)} onChange={() => onToggle(item.value)} />
                  <span className="filter-option-label">{item.display ?? item.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
