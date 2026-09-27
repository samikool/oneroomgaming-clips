export type InstallMode = "prompt" | "ios-hint" | "hidden";

/**
 * What the header's Install entry should be.
 *
 * Already installed (running standalone): nothing. A browser that fired
 * `beforeinstallprompt`: a button that prompts. iOS, which never prompts:
 * a hint pointing at Share → Add to Home Screen. Anything else has no
 * install path we can offer, so nothing.
 */
export function installMode({
  standalone,
  hasPrompt,
  ios,
}: {
  standalone: boolean;
  hasPrompt: boolean;
  ios: boolean;
}): InstallMode {
  if (standalone) return "hidden";
  if (hasPrompt) return "prompt";
  if (ios) return "ios-hint";
  return "hidden";
}

/**
 * iPhone and iPad. iPadOS Safari reports itself as a Mac, so a "Macintosh"
 * with a touch screen counts too — a real Mac has no touch points.
 */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/**
 * Inlined in <head> by the root layout: holds on to a `beforeinstallprompt`
 * that arrives before React has hydrated and registered its own listener.
 * `InstallButton` picks it up from `window.__installPrompt` on mount.
 */
export const EARLY_PROMPT_SCRIPT =
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__installPrompt=e;});";
