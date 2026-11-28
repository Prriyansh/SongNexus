// Addresses of the sizes of a picture that its host already serves, so a small picture stays small.

/** Widths Wikimedia keeps ready; others are refused or slow. */
const COMMONS_WIDTHS = [120, 250, 330, 500] as const;

/** A Commons photo no narrower than asked. Files too small to have a scaled version stay as they are. */
export function photoAt(url: string, width: number): string {
  if (!/\/\d+px-[^/]+$/.test(url)) return url;
  const stored = Number(/\/(\d+)px-[^/]+$/.exec(url)![1]);
  // Never larger than the version known to exist.
  const best = COMMONS_WIDTHS.find((w) => w >= width && w <= stored) ?? stored;
  return url.replace(/\/\d+px-([^/]+)$/, `/${best}px-$1`);
}

/** The `src` and `srcset` of a photo shown at a size in CSS pixels, sharp on dense screens. */
export function photoSources(url: string, size: number): { src: string; srcSet: string } {
  return {
    src: photoAt(url, size),
    srcSet: `${photoAt(url, size)} 1x, ${photoAt(url, size * 2)} 2x`,
  };
}
