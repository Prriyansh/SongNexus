// A song's credits, grouped for reading.
import type { Credit } from "./catalog";

const GROUPS: { title: string; roles: string[] }[] = [
  { title: "Performers", roles: ["primary", "featured"] },
  { title: "Producers", roles: ["producer"] },
  { title: "Vocals and instruments", roles: ["vocal", "instrument", "performer"] },
  {
    title: "Programming and arrangement",
    roles: ["programming", "arranger", "conductor", "remixer"],
  },
  { title: "Engineering", roles: ["engineer"] },
  { title: "Samples", roles: ["sampled"] },
];

// Roles that say something the group's title doesn't already.
const ROLE_WORDS: Record<string, string> = {
  featured: "featured",
  vocal: "vocals",
  programming: "programming",
  arranger: "arrangement",
  conductor: "conductor",
  remixer: "remix",
};

export type CreditGroup = { title: string; people: { artist: number; parts: string[] }[] };

/** Each person once per group, with every part they played. */
export function creditGroups(credits: Credit[]): CreditGroup[] {
  return GROUPS.map(({ title, roles }) => {
    const people = new Map<number, Set<string>>();
    for (const role of roles) {
      for (const credit of credits.filter((c) => c.role === role)) {
        const parts = people.get(credit.artist) ?? new Set<string>();
        const part = credit.detail || ROLE_WORDS[role];
        if (part) parts.add(part);
        people.set(credit.artist, parts);
      }
    }
    return { title, people: [...people].map(([artist, parts]) => ({ artist, parts: [...parts] })) };
  }).filter((group) => group.people.length > 0);
}
