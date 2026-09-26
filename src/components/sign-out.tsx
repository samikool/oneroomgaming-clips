export const SIGN_OUT_PATH = "/outpost.goauthentik.io/sign_out";

/**
 * Hands off to the Authentik outpost, which ends the session and runs the
 * invalidation flow. A plain <a>, not next/link: this must be a full
 * navigation out of the app.
 */
export function SignOut() {
  return (
    <a href={SIGN_OUT_PATH} className="sign-out" aria-label="Sign out" title="Sign out">
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
      >
        <path d="M15 4h4v16h-4" />
        <path d="M10 8l-4 4 4 4" />
        <path d="M6 12h10" />
      </svg>
    </a>
  );
}
