"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar } from "./avatar";
import { useDirectory } from "./profiles-provider";
import { formatAgo } from "@/lib/format";
import type { NotificationSummary } from "@/lib/realtime/envelope";
import { useRealtime } from "@/lib/realtime/use-realtime";
import { notificationHref, notificationText } from "@/lib/social/notification-text";

type Page = { items: NotificationSummary[]; unread: number };

/**
 * Your notifications: the first page on mount, live ones upserted by id and
 * moved to the top, older pages on demand. One instance, owned by the
 * activity bar, shared by the pill and the tray.
 */
export function useNotifications() {
  const [items, setItems] = useState<NotificationSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const loading = useRef(false);

  const load = useCallback(async (before?: number) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const response = await fetch(`/api/notifications${before === undefined ? "" : `?before=${before}`}`);
      if (!response.ok) return;
      const page = (await response.json()) as Page;
      setUnread(page.unread);
      setItems((current) => {
        if (before === undefined) return page.items;
        const seen = new Set(current.map((n) => n.id));
        return [...current, ...page.items.filter((n) => !seen.has(n.id))];
      });
      if (page.items.length === 0) setExhausted(true);
    } catch {
      // Offline or restarting: the bell stays as it was.
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Handlers read the latest list from here, so no state updater has side effects.
  const current = useRef(items);
  current.current = items;

  useRealtime(["user"], (message) => {
    if (message.t !== "notification") return;
    const next = message.notification;
    const previous = current.current.find((n) => n.id === next.id);
    const wasUnread = previous ? !previous.read : false;
    setUnread((u) => Math.max(0, u + (next.read ? 0 : 1) - (wasUnread ? 1 : 0)));
    setItems((list) => [next, ...list.filter((n) => n.id !== next.id)]);
  });

  /** Marks what the tray is showing as read, here and on the server. */
  const markShownRead = useCallback(() => {
    const ids = current.current.filter((n) => !n.read).map((n) => n.id);
    if (ids.length === 0) return;
    const marked = new Set(ids);
    // Update the ref now too, so an immediate second call (StrictMode) finds nothing to mark.
    current.current = current.current.map((n) => (marked.has(n.id) ? { ...n, read: true } : n));
    setUnread((u) => Math.max(0, u - ids.length));
    setItems((list) => list.map((n) => (marked.has(n.id) ? { ...n, read: true } : n)));
    void fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { unread: number } | null) => data && setUnread(data.unread))
      .catch(() => {});
  }, []);

  const loadMore = useCallback(() => {
    const last = items.at(-1);
    if (last && !exhausted) void load(last.updatedAt);
  }, [items, exhausted, load]);

  return { items, unread, exhausted, markShownRead, loadMore };
}

export type Notifications = ReturnType<typeof useNotifications>;

export function NotificationsPill({ unread, open, onToggle }: { unread: number; open: boolean; onToggle(): void }) {
  return (
    <button
      type="button"
      className={`pill${open ? " pill-open" : ""}${unread > 0 ? " pill-live" : " pill-quiet"}`}
      aria-expanded={open}
      aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
      onClick={onToggle}
    >
      {/* Drawn, not the 🔔 emoji, so it takes the pill's colour like the other icons. */}
      <svg viewBox="0 0 16 16" width="14" height="14" className="shrink-0" aria-hidden="true">
        <path d="M8 1.5a1 1 0 0 1 1 1v.6A4.5 4.5 0 0 1 12.5 7.5v3l1.5 2H2l1.5-2v-3A4.5 4.5 0 0 1 7 3.1v-.6a1 1 0 0 1 1-1z" fill="currentColor" />
        <path d="M6.25 13.5h3.5a1.75 1.75 0 0 1-3.5 0z" fill="currentColor" />
      </svg>
      {unread > 0 && <span className="font-pixel text-[10px]">{unread}</span>}
    </button>
  );
}

export function NotificationsTray({ notifications, onClose }: { notifications: Notifications; onClose(): void }) {
  const { items, exhausted, markShownRead, loadMore } = notifications;
  const directory = useDirectory();
  const nameOf = (username: string) => directory.find((p) => p.username === username)?.name ?? username;
  const end = useRef<HTMLDivElement | null>(null);

  // Opening the tray reads what it shows.
  useEffect(() => {
    markShownRead();
    // Only on open: later arrivals stay unread until the next look.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reaching the end of the list asks for the next page.
  useEffect(() => {
    const target = end.current;
    if (!target || exhausted) return;
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && loadMore());
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, exhausted]);

  return (
    <div className="tray tray-left" role="dialog" aria-label="Notifications">
      <div className="tray-head">
        <h2 className="text-sm">Notifications</h2>
        <button type="button" className="dock-dismiss" aria-label="Close notifications" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="tray-body">
        {items.length === 0 ? (
          <p className="p-3 text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ol className="notification-list">
            {items.map((n) => {
              const { lead, title, tail } = notificationText(n, nameOf);
              return (
                <li key={n.id}>
                  <Link href={notificationHref(n)} className={`notification${n.read ? "" : " notification-unread"}`} onClick={onClose}>
                    <span className="notification-avatars" aria-hidden="true">
                      {n.actors.slice(0, 3).map((actor) => (
                        <Avatar key={actor} username={actor} size={24} />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="notification-text">
                        {lead}
                        {title && <em>{title}</em>}
                        {tail}
                      </span>
                      <span className="notification-time">{formatAgo(n.updatedAt)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={end} aria-hidden="true" />
      </div>
    </div>
  );
}
