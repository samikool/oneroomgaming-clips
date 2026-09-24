import Link from "next/link";
import { activeFilters, withoutFilter, type ClipFilters } from "@/lib/filters";

const LABEL: Record<keyof ClipFilters, string> = {
  tag: "tag",
  game: "game",
  uploader: "from",
  participant: "with",
};

/** Active filters as removable chips above the grid. */
export function FilterChips({ filters }: { filters: ClipFilters }) {
  const active = activeFilters(filters);

  if (active.length === 0) {
    return null;
  }

  return (
    <div className="filter-chips">
      {active.map(({ key, value }) => (
        <Link key={key} className="filter-chip" href={withoutFilter(filters, key)}>
          <span className="text-ink-muted">{LABEL[key]}:</span> {value}
          <span aria-hidden="true"> ×</span>
          <span className="sr-only">Remove this filter</span>
        </Link>
      ))}
      <Link className="chip-button" href="/">
        Clear all
      </Link>
    </div>
  );
}
