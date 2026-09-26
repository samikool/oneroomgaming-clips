import { Pixelify_Sans, Silkscreen } from "next/font/google";

/** Headings and nav — the closest free match to the logo's wordmark. */
export const display = Pixelify_Sans({ subsets: ["latin"], variable: "--font-pixelify" });

/** Tiny labels only (duration, counts); unreadable at body sizes. */
export const pixel = Silkscreen({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-silkscreen",
});
