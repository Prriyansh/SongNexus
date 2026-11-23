/** Words for why something is on a map. The server sends the facts; wording stays here. */
import type {Schemas} from '../api/client';
import type {I18n} from '../i18n/i18n';

type Reason = Schemas['MapReason'];

/** "A, B and C" in the reader's language. */
export function listOf(locale: string, names: readonly string[]): string {
  try {
    return new Intl.ListFormat(locale, {type: 'conjunction'}).format(names);
  } catch {
    return names.join(', ');
  }
}

export function reasonText(
  {t, locale, formatNumber}: Pick<I18n, 't' | 'locale' | 'formatNumber'>,
  reason: Reason,
  context: {name: string; friend: string; hasFriend: boolean},
): string {
  const names = listOf(locale, reason.artists);
  const others = listOf(locale, reason.otherArtists);
  switch (reason.kind) {
    case 'CO_LISTENED':
      return t('map.reason.coListened', {played: names});
    case 'SHARED_GENRES':
      return t('map.reason.sharedGenres', {
        genres: listOf(locale, reason.genres),
      });
    case 'SOUND_MATCH':
      return t('map.reason.soundMatch', {
        score: formatNumber(reason.score ?? 0, {style: 'percent'}),
      });
    case 'ON_PLAYLIST':
      if (reason.count === null)
        return reason.theirs
          ? t('map.reason.onTheirs.song', {friend: context.friend})
          : t('map.reason.onMine.song');
      return reason.theirs
        ? t('map.reason.onTheirs', {
            friend: context.friend,
            count: reason.count,
          })
        : t('map.reason.onMine', {count: reason.count});
    case 'ON_BOTH':
      return reason.count === null
        ? t('map.reason.onBoth.song')
        : t('map.reason.onBoth', {
            count: reason.count,
            other: reason.otherCount ?? 0,
            friend: context.friend,
          });
    case 'CLOSE_TO_OTHER':
      return reason.theirs
        ? t('map.reason.forThem', {
            friend: context.friend,
            names,
            name: context.name,
          })
        : t('map.reason.forMe', {names, name: context.name});
    case 'NEW_TO_YOU':
      if (
        context.hasFriend &&
        reason.artists.length &&
        reason.otherArtists.length
      )
        return t('map.reason.newToBoth.split', {
          mine: names,
          theirs: others,
          friend: context.friend,
          name: context.name,
        });
      return t(
        context.hasFriend ? 'map.reason.newToBoth' : 'map.reason.newToYou',
        {
          names: listOf(locale, [...reason.artists, ...reason.otherArtists]),
          name: context.name,
        },
      );
  }
}
