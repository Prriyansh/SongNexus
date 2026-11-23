// An artist's photo from Wikimedia Commons: the file Wikidata names as the artist's image (P18),
// reached through the Wikidata link MusicBrainz holds, so nothing is matched by name. Only freely
// licensed photos are kept (public domain, CC0, CC BY, CC BY-SA), and each one comes with its
// author, license and file page so the app can credit it. Images are linked, never copied.

import { withCache } from "./musicbrainz";
import { sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import type { CommonsPhoto } from "./types";

const API = "https://commons.wikimedia.org/w/api.php";
const CACHE_MS = 24 * 60 * 60_000;
const THUMBNAIL_WIDTH = 330;
const MEDIA_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_AUTHOR_CHARS = 200;

type Meta = Record<string, { value?: unknown } | undefined>;
type Page = {
  missing?: boolean;
  imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; mime?: string; extmetadata?: Meta }[];
};
type Query = { query?: { pages?: Page[] } };

/** The text of an HTML fragment: tags dropped, a few common entities decoded, spaces collapsed. */
export function plainText(html: string): string {
  // Strip tags until none are left (one pass can rebuild one: "<scr<b>ipt>"), then drop any stray
  // angle brackets. Decode &amp; last so "&amp;quot;" becomes the text "&quot;", not a quote.
  let text = html;
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text
    .replace(/[<>]/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True for public domain, CC0, CC BY and CC BY-SA, any version or port. Non-commercial and
 * no-derivatives variants, fair use and anything unrecognized are not free enough to show.
 */
export function isFreeLicense(shortName: string): boolean {
  const name = shortName.toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!name) return false;
  if (["pd", "cc0", "cc0 1.0", "cc-zero"].includes(name) || name.startsWith("public domain") || name.startsWith("pd-")) return true;
  if (name.split(/[ -]/).some((token) => token === "nc" || token === "nd")) return false;
  return /^cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?:[ -][a-z]{2,})*$/.test(name);
}

const meta = (extmetadata: Meta | undefined, key: string) => {
  const value = extmetadata?.[key]?.value;
  return typeof value === "string" ? value.trim() : "";
};

const isMediaUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && MEDIA_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

/** The credited photo for a Commons file name (as Wikidata stores it), or null if it can't be shown. */
export async function commonsPhoto(fileName: string, options: SourceOptions = {}): Promise<CommonsPhoto | null> {
  const name = fileName.trim();
  if (!name || name.length > 240 || /[|#<>[\]{}]/.test(name)) return null;
  return withCache(`commons:${name}`, CACHE_MS, options.useCache ?? true, async () => {
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", redirects: "1", prop: "imageinfo",
      iiprop: "url|mime|extmetadata", iiurlwidth: String(THUMBNAIL_WIDTH),
      iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|NonFree",
      titles: `File:${name}`,
    });
    const page = (await sourceJson<Query>("Wikimedia Commons", `${API}?${params}`, {}, options)).query?.pages?.[0];
    const info = page?.missing ? undefined : page?.imageinfo?.[0];
    if (!info || !PHOTO_MIME.has(info.mime ?? "")) return null;
    const license = plainText(meta(info.extmetadata, "LicenseShortName"));
    if (meta(info.extmetadata, "NonFree").toLowerCase() === "true" || !isFreeLicense(license)) return null;
    const url = info.thumburl ?? info.url ?? "";
    const pageUrl = info.descriptionurl ?? "";
    if (!isMediaUrl(url) || !pageUrl.startsWith("https://commons.wikimedia.org/")) return null;
    const licenseUrl = meta(info.extmetadata, "LicenseUrl");
    return {
      url,
      pageUrl,
      author: plainText(meta(info.extmetadata, "Artist")).slice(0, MAX_AUTHOR_CHARS) || null,
      license,
      licenseUrl: licenseUrl.startsWith("https://") || licenseUrl.startsWith("http://") ? licenseUrl : null,
    };
  });
}
