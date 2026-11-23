// Reference facts about an artist from Wikidata and Wikipedia, plus a credited photo from Wikimedia
// Commons, reached through the Wikidata link MusicBrainz holds for that artist, so nothing is
// matched by name. No key needed.

import { withCache } from "./musicbrainz";
import { sourceJson } from "./credit-sources";
import type { SourceOptions } from "./credit-sources";
import { commonsPhoto } from "./commons";
import type { ArtistFacts, WikiLabelled } from "./types";

const API = "https://www.wikidata.org/w/api.php";
const CACHE_MS = 24 * 60 * 60_000;
const LABEL_BATCH = 50;

type SnakValue = { id?: string; time?: string } | string;
type Snak = { datavalue?: { value?: SnakValue } };
type Claim = { rank?: string; mainsnak?: Snak; qualifiers?: Record<string, Snak[]> };
type Entity = {
  claims?: Record<string, Claim[]>;
  descriptions?: { en?: { value?: string } };
  labels?: { en?: { value?: string } };
  sitelinks?: { enwiki?: { title?: string; url?: string } };
};
type Entities = { entities?: Record<string, Entity> };
type Summary = { extract?: string; thumbnail?: { source?: string }; content_urls?: { desktop?: { page?: string } } };

const AWARD = "P166", NOMINATION = "P1411", LABEL = "P264", ACTIVE_FROM = "P2031", POINT_IN_TIME = "P585", IMAGE = "P18";

const itemOf = (snak?: Snak) => { const value = snak?.datavalue?.value; return typeof value === "object" ? value.id : undefined; };
const timeOf = (snak?: Snak) => { const value = snak?.datavalue?.value; return typeof value === "object" ? value.time : undefined; };
const textOf = (snak?: Snak) => { const value = snak?.datavalue?.value; return typeof value === "string" ? value : undefined; };

const yearOfTime = (time?: string) => time?.match(/^\+?(\d{4})/)?.[1] ?? "";
const live = (claims: Claim[] = []) => claims.filter((claim) => claim.rank !== "deprecated");
const claimYear = (claim: Claim) => yearOfTime(timeOf(claim.qualifiers?.[POINT_IN_TIME]?.[0]));

/** Entries for a property, newest first. Entries without a name in English are dropped, not guessed. */
function labelled(claims: Claim[] | undefined, names: Map<string, string>): WikiLabelled[] {
  return live(claims)
    .flatMap((claim) => {
      const id = itemOf(claim.mainsnak);
      const name = id && names.get(id);
      return id && name ? [{ id, name, year: claimYear(claim) }] : [];
    })
    .sort((x, y) => y.year.localeCompare(x.year));
}

export async function artistFacts(qid: string, options: SourceOptions = {}): Promise<ArtistFacts | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  return withCache(`wikidata:${qid}`, CACHE_MS, options.useCache ?? true, async () => {
    const entity = (await sourceJson<Entities>("Wikidata", `${API}?action=wbgetentities&ids=${qid}&props=claims|sitelinks/urls|descriptions&languages=en&sitefilter=enwiki&format=json`, {}, options)).entities?.[qid];
    if (!entity?.claims) return null;

    const ids = [...new Set([AWARD, NOMINATION, LABEL].flatMap((p) => live(entity.claims![p]).flatMap((c) => itemOf(c.mainsnak) ?? [])))];
    const names = new Map<string, string>();
    for (let i = 0; i < ids.length; i += LABEL_BATCH) {
      const batch = ids.slice(i, i + LABEL_BATCH).join("|");
      const page = await sourceJson<Entities>("Wikidata", `${API}?action=wbgetentities&ids=${batch}&props=labels&languages=en&format=json`, {}, options);
      for (const [id, item] of Object.entries(page.entities ?? {})) if (item.labels?.en?.value) names.set(id, item.labels.en.value);
    }

    // The article is a bonus: facts still work without it.
    const title = entity.sitelinks?.enwiki?.title;
    let wikipedia: ArtistFacts["wikipedia"] = null;
    if (title) {
      try {
        const summary = await sourceJson<Summary>("Wikipedia", `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {}, options);
        const url = summary.content_urls?.desktop?.page ?? entity.sitelinks?.enwiki?.url;
        if (summary.extract && url) wikipedia = { url, extract: summary.extract, imageUrl: summary.thumbnail?.source ?? null };
      } catch (error) {
        console.warn(`[wikidata] no Wikipedia summary for ${qid}:`, error);
      }
    }

    // So is the photo: a preferred image if Wikidata marks one, else the first.
    const images = live(entity.claims[IMAGE]);
    const image = textOf((images.find((claim) => claim.rank === "preferred") ?? images[0])?.mainsnak);
    let photo: ArtistFacts["photo"] = null;
    if (image) {
      try {
        photo = await commonsPhoto(image, options);
      } catch (error) {
        console.warn(`[wikidata] no Commons photo for ${qid}:`, error);
      }
    }

    return {
      wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
      description: entity.descriptions?.en?.value ?? "",
      activeFrom: live(entity.claims[ACTIVE_FROM]).map((c) => yearOfTime(timeOf(c.mainsnak))).filter(Boolean).sort()[0] ?? "",
      awards: labelled(entity.claims[AWARD], names),
      nominations: labelled(entity.claims[NOMINATION], names),
      labels: labelled(entity.claims[LABEL], names),
      wikipedia,
      photo,
    };
  });
}
