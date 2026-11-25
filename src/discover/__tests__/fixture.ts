import { buildCatalog, type RawCatalog } from "../lib/catalog";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const artistId = (at: number) => uuid(100 + at);
export const songId = (at: number) => uuid(200 + at);

// Artists, by position.
export const [ANNA, BEN, CARA, DEV, EVE, FAY, GUS] = [0, 1, 2, 3, 4, 5, 6];
const NAMES = ["Anna", "Ben", "Cara", "Dev", "The Eve Band", "Fay", "Gus"];
// Roles and details, by position.
const [PRIMARY, FEATURED, PRODUCER, INSTRUMENT, ENGINEER, SAMPLED] = [0, 1, 2, 3, 4, 5];
const GUITAR = 1;

/**
 * Anna's song features Ben and is produced by Cara, with Gus engineering. Cara also produced
 * Dev's two songs, where Anna plays guitar on the first. Dev is in The Eve Band. Fay released an
 * album on the same label as Anna and shares nothing else with anyone.
 */
const raw: RawCatalog = {
  version: 1,
  roles: ["primary", "featured", "producer", "instrument", "engineer", "sampled"],
  details: ["", "guitar"],
  relationTypes: ["member_of"],
  artists: NAMES.map((name, at) => [
    artistId(at), name, "Person", "SE", at === BEN ? "the singer" : null, 1980, null, at === GUS ? 0 : 2, 1000 - at,
    at === ANNA ? [0, 80, 1, 20] : at === DEV ? [1, 100] : [], at === ANNA ? ["Änna Svensson"] : [],
  ]),
  extras: {},
  genres: [["pop", "pop", []], ["synth-pop", "synth-pop", [0]]],
  labels: [[uuid(1), "Small Label"]],
  songs: [
    [songId(0), "First", 2001, 181, [ANNA, PRIMARY, 0, BEN, FEATURED, 0, CARA, PRODUCER, 0, GUS, ENGINEER, 0]],
    [songId(1), "Second", 2003, null, [DEV, PRIMARY, 0, CARA, PRODUCER, 0, ANNA, INSTRUMENT, GUITAR]],
    [songId(2), "Third", 2004, null, [DEV, PRIMARY, 0, CARA, PRODUCER, 0, BEN, SAMPLED, 0]],
  ],
  releases: [
    [uuid(301), "Anna’s Album", 2001, null, [ANNA], [0], [0], []],
    [uuid(302), "Fay’s Album", 2003, null, [FAY], [0], [], []],
    [uuid(303), "Dev’s Album", 2020, null, [DEV], [0], [1, 2], []],
  ],
  relations: [[DEV, EVE, 0, 1999, null]],
};

export const fixture = () => buildCatalog(raw);
