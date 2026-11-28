// Which part of a name a search matched, for marking it. Safe to import from client components.

const fold = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Where `query` begins a word of `text`, ignoring case and accents, or null. */
export function matchRange(text: string, query: string): [start: number, end: number] | null {
  const wanted = fold(query.trim());
  if (!wanted) return null;
  // Folding can change lengths ("ﬁ" becomes "fi"), so each folded letter remembers its source.
  let folded = "";
  const source: number[] = [];
  for (let at = 0; at < text.length;) {
    const char = String.fromCodePoint(text.codePointAt(at)!);
    for (const letter of fold(char)) {
      folded += letter;
      for (let i = 0; i < letter.length; i++) source.push(at);
    }
    at += char.length;
  }
  for (let start = folded.indexOf(wanted); start >= 0; start = folded.indexOf(wanted, start + 1)) {
    if (start > 0 && /[\p{L}\p{N}]/u.test(folded[start - 1])) continue;
    const end = start + wanted.length;
    return [source[start], end < source.length ? source[end] : text.length];
  }
  return null;
}
