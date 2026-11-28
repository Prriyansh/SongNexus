import type { Metadata } from "next";

/** A page's title and description, for the browser, search engines and link previews. */
export function pageMetadata(
  name: string,
  description: string,
  path: string,
  image?: string | null,
): Metadata {
  const title = `${name} · Song Nexus`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: path,
      siteName: "Song Nexus",
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary" : "summary_large_image", title, description },
  };
}
