/** The header's tabs, left to right. Page slides follow this order. */
export const NAV_LINKS = [
  { href: "/", label: "Clips" },
  { href: "/theater", label: "Theater" },
  { href: "/collections", label: "Collections" },
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

/** Where the underline bar sits, relative to the nav. */
export type BarBox = { x: number; y: number; width: number };

/** Thickness of the active tab's underline. */
export const UNDERLINE_PX = 2;

/**
 * The underline for a link, from its offsets within the nav. The top counts
 * too: on a phone the links wrap onto a second row.
 */
export function underlineBox(link: {
  offsetLeft: number;
  offsetTop: number;
  offsetWidth: number;
  offsetHeight: number;
}): BarBox {
  return {
    x: link.offsetLeft,
    y: link.offsetTop + link.offsetHeight - UNDERLINE_PX,
    width: link.offsetWidth,
  };
}

/** Inline style that puts the underline bar on a box. */
export function barStyle({ x, y, width }: BarBox) {
  return { transform: `translate(${x}px, ${y}px)`, width: `${width}px` };
}

/** Tab positions the underline passes on its way, ending on the target. */
export function glideStops(from: number, to: number): number[] {
  const step = to > from ? 1 : -1;
  const stops: number[] = [];

  for (let i = from + step; i !== to + step; i += step) {
    stops.push(i);
  }

  return stops;
}

/**
 * Keyframes for the underline through a list of boxes, the first being where
 * it is now. Mirrors the page slide's strip: one even stretch per tab, linear,
 * with the last stretch settling so the bar lands with the page.
 */
export function glideFrames(boxes: BarBox[], settle: string) {
  const stretches = boxes.length - 1;

  return boxes.map((box, i) => ({
    ...barStyle(box),
    offset: i / stretches,
    ...(i < stretches && { easing: i === stretches - 1 ? settle : "linear" }),
  }));
}

/** Where a bar is this instant, part way through a glide or not. DOM only. */
export function currentBox(el: HTMLElement): BarBox {
  const style = getComputedStyle(el);
  const matrix = new DOMMatrixReadOnly(style.transform);

  return { x: matrix.m41, y: matrix.m42, width: parseFloat(style.width) };
}
