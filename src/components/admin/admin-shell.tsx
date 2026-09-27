import Link from "next/link";
import { ADMIN_SECTIONS, SECTION_LABELS, type AdminSection } from "@/lib/admin/sections";
import "./admin.css";

/**
 * The admin page's frame: a sidebar of sections on desktop that becomes a
 * scrolling tab row on a phone, and the selected section's panel beside it.
 * The section lives in `?s=`, so a reload or a shared link lands on it.
 */
export function AdminShell({ section, children }: { section: AdminSection; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-ink">Admin</h1>
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <nav aria-label="Admin sections" className="admin-nav">
          {ADMIN_SECTIONS.map((s) => (
            <Link
              key={s}
              href={`/admin?s=${s}`}
              aria-current={s === section ? "page" : undefined}
              className={`admin-nav-link${s === section ? " admin-nav-link-active" : ""}`}
            >
              {SECTION_LABELS[s]}
            </Link>
          ))}
        </nav>
        <section className="min-w-0 flex-1" aria-label={SECTION_LABELS[section]}>
          {children}
        </section>
      </div>
    </main>
  );
}
