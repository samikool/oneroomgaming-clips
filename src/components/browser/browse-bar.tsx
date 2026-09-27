"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { BrowseOptions } from "@/db/browse-options";
import { isFiltered, SORTS, type Sort } from "@/lib/browse/query";
import type { Browse, FilterField } from "@/lib/browse/use-browse";
import { barStyle, currentBox, glideFrames, glideStops, underlineBox } from "@/lib/nav";
import { Avatar } from "../avatar";
import { PANEL_MS, SETTLE } from "../page-slide";
import { useDirectory } from "../profiles-provider";
import { UserName } from "../user-name";
import { FilterPopover, type FilterItem } from "./filter-popover";

export const TAB_LABEL: Record<Sort, string> = { new: "New", trending: "Trending", top: "Top", random: "Random" };

export function panelId(sort: Sort): string {
  return `browse-panel-${sort}`;
}

export function tabId(sort: Sort): string {
  return `browse-tab-${sort}`;
}

/** Keeps a selected value on the list even when nothing carries it any more, so it can be unticked. */
function withSelected(items: FilterItem[], selected: string[]): FilterItem[] {
  const known = new Set(items.map((item) => item.value));
  return [...items, ...selected.filter((value) => !known.has(value)).map((value) => ({ value, text: value }))];
}

/**
 * The browser's sticky bar: tabs with a gliding underline, search, the three
 * filter buttons, and the removable chips for whatever is active.
 */
export function BrowseBar({
  browse,
  options,
  trailing,
}: {
  browse: Browse;
  options: BrowseOptions;
  /** Page-specific controls at the end of the filter row (home's Select). */
  trailing?: ReactNode;
}) {
  const { query, active, setActive, setSearch, toggleFilter, clearFilters, reseed } = browse;
  const people = useDirectory();

  const gameItems = useMemo(
    () => withSelected(options.games.map((g) => ({ value: g.slug, text: g.name })), query.games),
    [options.games, query.games],
  );
  const tagItems = useMemo(
    () => withSelected(options.tags.map((t) => ({ value: t, text: `#${t}` })), query.tags),
    [options.tags, query.tags],
  );
  const peopleItems = useMemo(
    () =>
      withSelected(
        people.map((p) => ({
          value: p.username,
          text: `${p.name} ${p.username}`,
          display: (
            <span className="inline-flex min-w-0 items-center gap-2">
              <Avatar username={p.username} size={20} />
              <UserName username={p.username} variant="compact" withAvatar={false} link={false} />
            </span>
          ),
        })),
        query.people,
      ),
    [people, query.people],
  );

  const gameName = (slug: string) => options.games.find((g) => g.slug === slug)?.name ?? slug;
  const chips: { field: FilterField; value: string; label: ReactNode }[] = [
    ...query.games.map((value) => ({ field: "games" as const, value, label: gameName(value) })),
    ...query.tags.map((value) => ({ field: "tags" as const, value, label: `#${value}` })),
    ...query.people.map((value) => ({
      field: "people" as const,
      value,
      label: <UserName username={value} variant="compact" link={false} />,
    })),
  ];

  return (
    <div className="browse-bar">
      <BrowseTabs active={active} onSelect={(sort) => (sort === active && sort === "random" ? reseed() : setActive(sort))} />

      <div className="browse-controls">
        <div className="browse-search">
          <input
            type="search"
            className="browse-search-input"
            placeholder="Search titles, games, tags, people, comments"
            aria-label="Search clips"
            maxLength={100}
            value={query.q}
            onChange={(event) => setSearch(event.target.value)}
          />
          {query.q && (
            <button type="button" className="browse-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>
              ✕
            </button>
          )}
        </div>
        <div className="browse-filter-row">
          <FilterPopover label="Game" items={gameItems} selected={query.games} onToggle={(v) => toggleFilter("games", v)} />
          <FilterPopover label="Tag" items={tagItems} selected={query.tags} onToggle={(v) => toggleFilter("tags", v)} />
          <FilterPopover label="People" items={peopleItems} selected={query.people} onToggle={(v) => toggleFilter("people", v)} />
          {trailing && <div className="ml-auto flex gap-2">{trailing}</div>}
        </div>
      </div>

      {isFiltered(query) && (
        <div className="filter-chips browse-chips">
          {chips.map((chip) => (
            <button
              key={`${chip.field}:${chip.value}`}
              type="button"
              className="filter-chip"
              onClick={() => toggleFilter(chip.field, chip.value)}
            >
              {chip.label}
              <span aria-hidden="true"> ×</span>
              <span className="sr-only">Remove this filter</span>
            </button>
          ))}
          <button type="button" className="chip-button" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}

/** New · Trending · Top · Random, with one underline that glides like the header's. */
function BrowseTabs({ active, onSelect }: { active: Sort; onSelect(sort: Sort): void }) {
  const list = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const shown = useRef<number | null>(null);
  const glide = useRef<Animation | null>(null);
  const target = SORTS.indexOf(active);

  useLayoutEffect(() => {
    const el = bar.current;
    const from = shown.current;
    shown.current = target;

    if (!el || from === target) return;

    const stops = from === null ? [target] : glideStops(from, target);
    const boxes = stops.map((i) => tabs.current[i]).filter((tab) => tab !== null).map(underlineBox);
    const end = boxes.at(-1);

    if (!end) return;

    const now = currentBox(el);
    glide.current?.cancel();
    Object.assign(el.style, barStyle(end));
    list.current?.setAttribute("data-underline", "");

    if (from === null || boxes.length !== stops.length || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    // One PANEL_MS per tab crossed, landing on SETTLE: in step with the strip below.
    glide.current = el.animate(glideFrames([now, ...boxes], SETTLE), { duration: stops.length * PANEL_MS });
  }, [target]);

  useEffect(() => {
    const el = list.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      const tab = shown.current === null ? null : tabs.current[shown.current];
      if (tab && bar.current) {
        glide.current?.cancel();
        Object.assign(bar.current.style, barStyle(underlineBox(tab)));
      }
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = SORTS[(target + step + SORTS.length) % SORTS.length];
    onSelect(next);
    tabs.current[SORTS.indexOf(next)]?.focus();
  }

  return (
    <div ref={list} className="browse-tabs" role="tablist" aria-label="Sort clips" onKeyDown={onKeyDown}>
      {SORTS.map((sort, i) => (
        <button
          key={sort}
          ref={(node) => {
            tabs.current[i] = node;
          }}
          id={tabId(sort)}
          type="button"
          role="tab"
          aria-selected={sort === active}
          aria-controls={panelId(sort)}
          tabIndex={sort === active ? 0 : -1}
          title={sort === "random" && sort === active ? "Shuffle again" : undefined}
          className={`nav-link browse-tab${sort === active ? " nav-link-active" : ""}`}
          onClick={() => onSelect(sort)}
        >
          {TAB_LABEL[sort]}
          {sort === "random" && sort === active && (
            <span aria-hidden="true" className="browse-tab-reshuffle">
              ↻
            </span>
          )}
        </button>
      ))}
      <span ref={bar} className="nav-underline" aria-hidden="true" />
    </div>
  );
}
