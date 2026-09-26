/** A small stepped, pixel-style spinner. Under reduced motion it is a static "…". */
export function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="img" aria-label={label} />;
}
