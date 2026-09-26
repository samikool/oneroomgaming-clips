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
  className,
}: {
  username: string;
  filterHref: string;
  className: string;
}) {
  return (
    <span className="person-chip">
      <Link href={profileHref(username)} className="person-chip-avatar" aria-label={`@${username}'s profile`}>
        <Avatar username={username} size={16} />
      </Link>
      <Link className={className} href={filterHref}>
        <UserName username={username} variant="compact" link={false} />
      </Link>
    </span>
  );
}
