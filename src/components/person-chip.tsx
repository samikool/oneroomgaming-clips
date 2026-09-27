import Link from "next/link";
import { Avatar } from "./avatar";
import { UserName } from "./user-name";
import { profileHref } from "@/lib/profiles/href";

/**
 * A person as a filter chip. The chip still filters, as it always has; the
 * avatar beside it opens their profile. Two sibling links, because an anchor
 * inside an anchor is invalid HTML.
 */
export function PersonChip({
  username,
  filterHref,
  onFilter,
  className,
}: {
  username: string;
  className: string;
} & ({ filterHref: string; onFilter?: never } | { onFilter: () => void; filterHref?: never })) {
  const name = <UserName username={username} variant="compact" link={false} />;

  return (
    <span className="person-chip">
      <Link href={profileHref(username)} className="person-chip-avatar" aria-label={`@${username}'s profile`}>
        <Avatar username={username} size={16} />
      </Link>
      {/* The clip browser filters in place; everywhere else the chip is a link to home, filtered. */}
      {onFilter ? (
        <button type="button" className={className} onClick={onFilter}>
          {name}
        </button>
      ) : (
        <Link className={className} href={filterHref}>
          {name}
        </Link>
      )}
    </span>
  );
}
