/** The header's tabs, left to right. Page slides follow this order. */
export const NAV_LINKS = [
  { href: "/", label: "Clips" },
  { href: "/theater", label: "Theater" },
  { href: "/upload", label: "Upload" },
  { href: "/changelog", label: "Changelog" },
] as const;

/**
 * Which header link is the current page. A clip page counts as Clips, since
 * that is where it was opened from. Matching is by path segment, so
 * `/theaterx` does not light up Theater.
 */
export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/clips/");
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The header tab a page belongs to, by position, or null for any other page. */
export function navIndex(pathname: string): number | null {
  const index = NAV_LINKS.findIndex(({ href }) => isActiveNav(pathname, href));

  return index === -1 ? null : index;
}

/** Labels of the tabs strictly between two positions, in the order passed. */
export function tabsBetween(from: number, to: number): string[] {
  const step = to > from ? 1 : -1;
  const labels: string[] = [];

  for (let i = from + step; i !== to; i += step) {
    labels.push(NAV_LINKS[i].label);
  }

  return labels;
}
