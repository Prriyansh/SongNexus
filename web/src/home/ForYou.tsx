/**
 * Home's personal part: an invitation to the Personalize page on a first visit, and the
 * For you shelf (the server's recommendations, each card saying why it is there).
 */
import {Link} from 'react-router';

import {useForYou, type FeedItem} from '../api/foryou';
import {useAuth} from '../auth/AuthProvider';
import {artistPath, imageOf} from '../components/ArtistRow';
import {Icon} from '../components/Icon';
import {CoverCard, Shelf} from '../components/Shelf';
import {useI18n} from '../i18n/i18n';
import {savePicks, usePicks} from '../taste/picks';

/** Why a card is there, in a few words, from the reason the server gives. */
export function useReason(): (item: FeedItem) => string {
  const {t} = useI18n();
  return item => {
    const reason = item.reason;
    const via = reason.viaArtist?.displayName;
    switch (reason.kind) {
      case 'CONNECTED':
        return via
          ? t('forYou.reason.connected', {name: via})
          : t('forYou.reason.discover');
      case 'FANS_ALSO':
        return via
          ? t('forYou.reason.fansAlso', {name: via})
          : t('forYou.reason.discover');
      case 'SIMILAR':
        return via
          ? t('forYou.reason.similar', {name: via})
          : t('forYou.reason.discover');
      case 'GENRE':
        return reason.genre
          ? t('forYou.reason.genre', {genre: reason.genre.displayName})
          : t('forYou.reason.discover');
      case 'FRIENDS':
        return t('forYou.reason.friends', {count: reason.friends});
      default:
        return t('forYou.reason.discover');
    }
  };
}

/** Shown until the listener personalizes or says not now. */
export function PersonalizeInvite() {
  const {t} = useI18n();
  const picks = usePicks();
  if (picks.done) return null;
  return (
    <section className="pz-invite" aria-labelledby="pz-invite-title">
      <span className="pz-invite__icon" aria-hidden="true">
        <Icon name="tune" size={28} />
      </span>
      <div className="pz-invite__text">
        <h2 id="pz-invite-title" className="pz-invite__title">
          {t('personalize.invite.title')}
        </h2>
        <p className="pz-invite__body">{t('personalize.invite.body')}</p>
      </div>
      <div className="pz-invite__actions">
        <Link className="btn btn--filled" to="/personalize">
          {t('personalize.invite.action')}
        </Link>
        <button
          type="button"
          className="btn btn--text"
          onClick={() => savePicks({...picks, done: true})}
        >
          {t('personalize.invite.later')}
        </button>
      </div>
    </section>
  );
}

/** The listener's recommendations; nothing when there's nothing to start from. */
export function ForYouShelf() {
  const {t} = useI18n();
  const auth = useAuth();
  const picks = usePicks();
  const signedIn = auth.status === 'signedIn';
  const feed = useForYou(
    signedIn,
    picks.artists.map(a => a.name),
  );
  const reason = useReason();
  const items = feed.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <div id="for-you" className="for-you">
      <Shelf
        eyebrow={t('forYou.eyebrow')}
        title={t('forYou.title')}
        action={
          <Link className="btn btn--outlined btn--compact" to="/personalize">
            <Icon name="tune" />
            {t('forYou.edit')}
          </Link>
        }
      >
        {items.map(item => (
          <CoverCard
            key={item.artist.name}
            to={artistPath(item.artist)}
            title={item.artist.displayName}
            subtitle={reason(item)}
            image={imageOf(item.artist)}
            round
          />
        ))}
      </Shelf>
    </div>
  );
}
