// Renders whole pages to HTML, waiting for their async parts, as the server does.
import { text } from "node:stream/consumers";
import type { ReactNode } from "react";
import { prerenderToNodeStream } from "react-dom/static";

export async function renderPage(page: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(page, {
    onError: (e) => errors.push(e) as never,
  });
  const html = await text(prelude);
  if (errors.length) throw errors[0];
  return html;
}

/** What a reader sees: no tags, entities decoded. */
export function textOf(html: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#x27": "'" };
  return html
    .replace(/<(script|style)[^>]*>.*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&([a-z]+|#x27);/g, (whole, name) => entities[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

export const hrefsOf = (html: string) =>
  [...html.matchAll(/ href="([^"]*)"/g)].map(([, href]) => href.replace(/&amp;/g, "&"));

/** An address's parameters, as Next passes them to a page. */
export const query = (params: Record<string, string | string[]> = {}) => ({
  searchParams: Promise.resolve(params),
  params: Promise.resolve({}),
});

export const route = (id: string) => ({
  params: Promise.resolve({ id }),
  searchParams: Promise.resolve({}),
});
