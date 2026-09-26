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
