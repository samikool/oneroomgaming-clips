export const ADMIN_SECTIONS = ["clips", "storage", "jobs", "games", "users"] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const SECTION_LABELS: Record<AdminSection, string> = {
  clips: "Clips",
  storage: "Storage",
  jobs: "Jobs",
  games: "Games & tags",
  users: "Users",
};

/** `?s=` as the page receives it. Anything unknown is the default, clips. */
export function parseSection(raw: string | string[] | undefined): AdminSection {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ADMIN_SECTIONS as readonly string[]).includes(value ?? "") ? (value as AdminSection) : "clips";
}
