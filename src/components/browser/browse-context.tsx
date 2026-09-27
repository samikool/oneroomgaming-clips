"use client";

import { createContext, useContext } from "react";
import type { FilterField } from "@/lib/browse/use-browse";

/** How a card's chips reach the browser's query without prop-drilling through the panels. */
export type BrowseActions = { toggleFilter(field: FilterField, value: string): void };

export const BrowseContext = createContext<BrowseActions | null>(null);

export function useBrowseActions(): BrowseActions | null {
  return useContext(BrowseContext);
}
