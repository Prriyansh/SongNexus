/**
 * Preset playlists for trying the maps without a file. Ordered by the genres you picked on
 * Personalize, so the first ones offered sound like you (Helen's Friends presets).
 */
import type {MessageId} from '../i18n/messages';

import type {Track} from './playlist';

export interface Preset {
  id: string;
  label: MessageId;
  /** Genre words that make this preset a match (compared with picked genre names). */
  genres: readonly string[];
  tracks: Track[];
}

const rows = (list: readonly (readonly [string, string])[]): Track[] =>
  list.map(([title, artist]) => ({title, artists: [artist]}));

export const PRESETS: readonly Preset[] = [
  {
    id: 'pop',
    label: 'map.preset.pop',
    genres: ['pop', 'dance', 'electropop', 'synth'],
    tracks: rows([
      ['Espresso', 'Sabrina Carpenter'],
      ['vampire', 'Olivia Rodrigo'],
      ['Anti-Hero', 'Taylor Swift'],
      ['Levitating', 'Dua Lipa'],
      ['As It Was', 'Harry Styles'],
      ['bad guy', 'Billie Eilish'],
      ['Flowers', 'Miley Cyrus'],
      ['Good Luck, Babe!', 'Chappell Roan'],
    ]),
  },
  {
    id: 'hiphop',
    label: 'map.preset.hiphop',
    genres: ['hip hop', 'rap', 'trap', 'hip-hop'],
    tracks: rows([
      ['HUMBLE.', 'Kendrick Lamar'],
      ['SICKO MODE', 'Travis Scott'],
      ['God’s Plan', 'Drake'],
      ['Money Trees', 'Kendrick Lamar'],
      ['See You Again', 'Tyler, The Creator'],
      ['Stronger', 'Kanye West'],
      ['N95', 'Kendrick Lamar'],
      ['Mask Off', 'Future'],
    ]),
  },
  {
    id: 'rnb',
    label: 'map.preset.rnb',
    genres: ['r&b', 'soul', 'neo soul'],
    tracks: rows([
      ['Kill Bill', 'SZA'],
      ['Snooze', 'SZA'],
      ['Pink + White', 'Frank Ocean'],
      ['Blinding Lights', 'The Weeknd'],
      ['Best Part', 'Daniel Caesar'],
      ['Redbone', 'Childish Gambino'],
      ['Cuff It', 'Beyoncé'],
      ['Leave the Door Open', 'Bruno Mars'],
    ]),
  },
  {
    id: 'indie',
    label: 'map.preset.indie',
    genres: ['indie', 'alternative', 'rock', 'folk'],
    tracks: rows([
      ['Motion Sickness', 'Phoebe Bridgers'],
      ['Heat Waves', 'Glass Animals'],
      ['Do I Wanna Know?', 'Arctic Monkeys'],
      ['Royals', 'Lorde'],
      ['Mr. Brightside', 'The Killers'],
      ['Kyoto', 'Phoebe Bridgers'],
      ['The Less I Know the Better', 'Tame Impala'],
    ]),
  },
  {
    id: 'latin',
    label: 'map.preset.latin',
    genres: ['latin', 'reggaeton', 'urbano'],
    tracks: rows([
      ['Tití Me Preguntó', 'Bad Bunny'],
      ['Despacito', 'Luis Fonsi'],
      ['Hawái', 'Maluma'],
      ['TQG', 'KAROL G'],
      ['Pepas', 'Farruko'],
      ['Mi Gente', 'J Balvin'],
    ]),
  },
];

/** Presets that match your genres first, then the rest in their usual order. */
export function presetsFor(genres: readonly string[]): Preset[] {
  const mine = genres.map(g => g.toLowerCase());
  const score = (preset: Preset) =>
    mine.filter(g => preset.genres.some(word => g.includes(word))).length;
  return PRESETS.map((preset, index) => ({preset, index, score: score(preset)}))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({preset}) => preset);
}
