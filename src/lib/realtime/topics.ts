import { TOPICS, type Topic } from "./envelope";

/**
 * The set of topics the shared socket should hold, given what every mounted
 * component has asked for.
 *
 * Sorted, so that the provider can compare a new union to the last one it sent
 * with a plain string join and skip a redundant `sub` frame.
 */
export function unionTopics(groups: Topic[][]): Topic[] {
  const wanted = new Set(groups.flat());
  return TOPICS.filter((topic) => wanted.has(topic));
}
