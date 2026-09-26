"use client";

import { useStoredFlag } from "@/lib/ui/use-stored-flag";

/**
 * A theater side column that collapses to a thin rail so the video can take
 * the room. Collapsing is a desktop affordance: below `lg` the panels stack
 * under the player and the rail is never shown.
 */
export function SidePanel({
  id,
  title,
  side,
  hiddenOnMobile,
  children,
}: {
  id: string;
  title: string;
  side: "left" | "right";
  /** Below lg, whether the phone tabs have this panel switched away. */
  hiddenOnMobile: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useStoredFlag(`theater.${id}.collapsed`, false);
  const arrow = (side === "left") === collapsed ? "»" : "«";

  return (
    <aside
      className={`side-panel${collapsed ? " side-panel-collapsed" : ""}${
        hiddenOnMobile ? " side-panel-tab-hidden" : ""
      }`}
      aria-label={title}
    >
      <div className="side-panel-head">
        <h2 className="side-panel-title">{title}</h2>
        <button
          type="button"
          className="side-panel-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Show ${title.toLowerCase()}` : `Hide ${title.toLowerCase()}`}
          onClick={() => setCollapsed(!collapsed)}
        >
          {arrow}
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
    </aside>
  );
}
