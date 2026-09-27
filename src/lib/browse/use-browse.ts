"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { Scope } from "@/db/browse";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { fetchTabs } from "./client";
import { freshSeed, isFiltered, serializeBrowseQuery, SORTS, type BrowseQuery, type Sort } from "./query";
import { browseReducer, initialBrowseState, scopeLive, type BrowseState, type Page } from "./tab-state";

export const SEARCH_DEBOUNCE_MS = 250;

export type FilterField = "games" | "tags" | "people";

export type Browse = {
  query: BrowseQuery;
  active: Sort;
  state: BrowseState;
  setActive(sort: Sort): void;
  setSearch(q: string): void;
  toggleFilter(field: FilterField, value: string): void;
  clearFilters(): void;
  loadMore(sort: Sort): void;
  retry(): void;
  reseed(): void;
};

/**
 * The browser's state: four tabs, one shared query, fetches guarded by a
 * sequence number so a slow old response never overwrites a newer one. The
 * address bar follows along with replaceState — no navigation, no history.
 */
export function useBrowse({
  initialQuery,
  initialPages,
  scope,
}: {
  initialQuery: BrowseQuery;
  initialPages: Record<Sort, Page>;
  scope: Scope;
}): Browse {
  const [state, dispatch] = useReducer(browseReducer, initialPages, initialBrowseState);
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState<Sort>(initialQuery.sort);

  const queryRef = useRef(query);
  const stateRef = useRef(state);
  stateRef.current = state;
  const seqRef = useRef(0);
  // Bumped per tab whenever that tab's list is replaced, so a page fetched for
  // the old list is not appended to the new one.
  const genRef = useRef<Record<Sort, number>>({ new: 0, trending: 0, top: 0, random: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingRef = useRef(new Set<string>());

  /** Fetches `tabs` for the current query under the current sequence number. */
  const fetchCurrent = useCallback(
    (tabs: readonly Sort[]) => {
      const seq = seqRef.current;
      fetchTabs(queryRef.current, { scope, tabs }).then(
        (response) => dispatch({ type: "tabsLoaded", seq, pages: response.tabs }),
        () => dispatch({ type: "tabsFailed", seq }),
      );
    },
    [scope],
  );

  const changeQuery = useCallback(
    (next: BrowseQuery, { debounce = false } = {}) => {
      queryRef.current = next;
      setQuery(next);
      seqRef.current += 1;
      for (const sort of SORTS) genRef.current[sort] += 1;
      // Every tab dims now; typing more only moves the fetch later.
      dispatch({ type: "queryChanged", seq: seqRef.current });

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;

      if (debounce) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          fetchCurrent(SORTS);
        }, SEARCH_DEBOUNCE_MS);
      } else {
        fetchCurrent(SORTS);
      }
    },
    [fetchCurrent],
  );

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const setSearch = useCallback(
    (q: string) => changeQuery({ ...queryRef.current, q }, { debounce: true }),
    [changeQuery],
  );

  const toggleFilter = useCallback(
    (field: FilterField, value: string) => {
      const current = queryRef.current[field];
      const nextValues = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      changeQuery({ ...queryRef.current, [field]: nextValues });
    },
    [changeQuery],
  );

  const clearFilters = useCallback(
    () => changeQuery({ ...queryRef.current, q: "", games: [], tags: [], people: [] }),
    [changeQuery],
  );

  const loadMore = useCallback(
    (sort: Sort) => {
      const tab = stateRef.current.tabs[sort];
      if (tab.next === null || tab.loading) return;

      const gen = genRef.current[sort];
      dispatch({ type: "pageRequested", sort });
      fetchTabs({ ...queryRef.current, sort }, { scope, tabs: [sort], cursor: tab.next }).then(
        (response) => {
          if (genRef.current[sort] !== gen) return;
          dispatch({ type: "pageLoaded", sort, page: response.tabs[sort] ?? { clips: [], next: null } });
        },
        () => {
          if (genRef.current[sort] !== gen) return;
          dispatch({ type: "pageFailed", sort });
        },
      );
    },
    [scope],
  );

  const reseed = useCallback(() => {
    const next = { ...queryRef.current, seed: freshSeed() };
    // A query fetch still in flight would be dropped by the new sequence
    // number, leaving its tabs dimmed forever; refetch everything instead.
    const pending = SORTS.some((sort) => sort !== "random" && stateRef.current.tabs[sort].stale);

    if (pending || timerRef.current) {
      changeQuery(next);
      return;
    }

    queryRef.current = next;
    setQuery(next);
    seqRef.current += 1;
    genRef.current.random += 1;
    dispatch({ type: "reseed", seq: seqRef.current });
    fetchCurrent(["random"]);
  }, [changeQuery, fetchCurrent]);

  const retry = useCallback(() => {
    const { tabs } = stateRef.current;

    if (SORTS.some((sort) => tabs[sort].stale && tabs[sort].error)) {
      changeQuery(queryRef.current);
    } else {
      loadMore(active);
    }
  }, [active, changeQuery, loadMore]);

  // The address bar is the shareable form of what's on screen. The seed stays
  // out of it: a shared link gets its own shuffle.
  useEffect(() => {
    const qs = serializeBrowseQuery({ ...query, sort: active });
    const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;

    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [query, active]);

  useRealtime(["grid"], (message) => {
    const admitted = scopeLive(scope, message, waitingRef.current);

    if (admitted) {
      dispatch({ type: "live", message: admitted, filtered: isFiltered(queryRef.current) });
    }
  });

  return { query, active, state, setActive, setSearch, toggleFilter, clearFilters, loadMore, retry, reseed };
}
