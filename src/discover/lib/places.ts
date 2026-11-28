// Countries to look around, by ISO code, named in English. Safe to import from client components.

const names = new Intl.DisplayNames(["en"], { type: "region" });

/** Every two-letter region with an English name, by name; MusicBrainz's X- codes left out. */
export const COUNTRIES: [code: string, name: string][] = (() => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWYZ";
  const found: [string, string][] = [];
  for (const a of letters)
    for (const b of letters + "X") {
      const code = a + b;
      const name = names.of(code);
      if (name && name !== code) found.push([code, name]);
    }
  return found.sort(([, x], [, y]) => x.localeCompare(y));
})();

export const aroundHref = (id: string) => `/discover/around?c=${encodeURIComponent(id)}`;
