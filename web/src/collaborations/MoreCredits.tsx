/**
 * More credits on an artist comparison: people Discogs and Genius credit on both artists' work,
 * beyond the MusicBrainz connections. Each person shows the source, the roles on each side and
 * the releases or songs as evidence, one tap away; each source says what it checked.
 */
import type {CSSProperties} from 'react';
import {Link} from 'react-router';

import type {Schemas} from '../api/client';
import {useMoreCredits} from '../api/queries';
import {artistPath, imageOf} from '../components/ArtistRow';
import {useListFormat} from '../components/AskAnswer';
import {Cover} from '../components/Shelf';
import {SIDE_COLOR} from '../connect/mixtape';
import {useI18n} from '../i18n/i18n';
import type {MessageId} from '../i18n/messages';

type Credits = Schemas['ListMoreCreditsResponse'];
type Person = Schemas['SourcedCollaborator'];
type Check = Schemas['CreditSourceCheck'];

const SHOWN = 12;
const KNOWN_ROLES = new Set([
  'producer',
  'mixing',
  'songwriting',
  'programming',
  'engineering',
  'featured',
  'vocals',
  'instruments',
]);

function sourceName(source: string): string {
  return source.endsWith('/genius') ? 'Genius' : 'Discogs';
}

function useRoles(): (roles: string[]) => string {
  const {t} = useI18n();
  const formatList = useListFormat();
  return roles =>
    formatList(
      roles.map(role =>
        KNOWN_ROLES.has(role)
          ? t(`moreCredits.role.${role}` as MessageId)
          : role,
      ),
    );
}

/** What each source checked, in one sentence each. */
function checkText(t: ReturnType<typeof useI18n>['t'], check: Check): string {
  const source = sourceName(check.source);
  switch (check.status) {
    case 'OK':
    case 'PARTIAL':
      return t(
        check.status === 'OK'
          ? 'moreCredits.check.ok'
          : 'moreCredits.check.partial',
        {
          source,
          a: check.scannedA,
          b: check.scannedB,
          unit: check.unit,
        },
      );
    case 'NO_KEY':
      return t('moreCredits.check.noKey', {source});
    case 'NO_MATCH':
      return t('moreCredits.check.noMatch', {source});
    default:
      return t('moreCredits.check.failed', {source});
  }
}

function Evidence({
  works,
  side,
}: {
  works: Schemas['CreditWork'][];
  side: 'a' | 'b';
}) {
  if (works.length === 0) return null;
  return (
    <ul
      className="mc-evidence"
      style={{'--side': SIDE_COLOR[side]} as CSSProperties}
    >
      {works.slice(0, 2).map(work => (
        <li key={work.url}>
          <a href={work.url} target="_blank" rel="noreferrer">
            <bdi>{work.title}</bdi>
          </a>
          {work.year !== null && (
            <span className="mc-evidence__year">{work.year}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function PersonRow({person, names}: {person: Person; names: [string, string]}) {
  const {t} = useI18n();
  const roles = useRoles();
  const name = <bdi>{person.displayName}</bdi>;
  return (
    <li className="mc-person">
      <Cover
        name={person.displayName}
        image={person.artist ? imageOf(person.artist) : null}
        round
      />
      <div className="mc-person__body">
        <div className="mc-person__head">
          {person.artist ? (
            <Link className="mc-person__name" to={artistPath(person.artist)}>
              {name}
            </Link>
          ) : (
            <a
              className="mc-person__name"
              href={person.url}
              target="_blank"
              rel="noreferrer"
            >
              {name}
            </a>
          )}
          <span className="mc-source">{sourceName(person.source)}</span>
        </div>
        <p className="mc-person__roles">
          {t('moreCredits.roles', {
            a: names[0],
            rolesA: roles(person.rolesA),
            b: names[1],
            rolesB: roles(person.rolesB),
          })}
        </p>
        <div className="mc-person__evidence">
          <Evidence works={person.evidenceA} side="a" />
          <Evidence works={person.evidenceB} side="b" />
        </div>
      </div>
    </li>
  );
}

function Body({data, names}: {data: Credits; names: [string, string]}) {
  const {t} = useI18n();
  const people = data.collaborators.slice(0, SHOWN);
  return (
    <>
      {people.length === 0 ? (
        <p className="cx-card__empty">{t('moreCredits.none')}</p>
      ) : (
        <ul className="mc-people">
          {people.map(person => (
            <PersonRow
              key={`${person.source}-${person.url}`}
              person={person}
              names={names}
            />
          ))}
        </ul>
      )}
      {data.direct.length > 0 && (
        <div className="mc-direct">
          <h3 className="cx-apart__title">{t('moreCredits.direct')}</h3>
          <Evidence works={data.direct} side="a" />
        </div>
      )}
      <ul className="mc-checks">
        {data.checks.map(check => (
          <li key={check.source}>{checkText(t, check)}</li>
        ))}
      </ul>
    </>
  );
}

/** The card, for two artists (`a` and `b` are artist IDs). */
export function MoreCredits({
  a,
  b,
  names,
}: {
  a: string;
  b: string;
  names: [string, string];
}) {
  const {t} = useI18n();
  const result = useMoreCredits(a, b);
  return (
    <section
      className="cx-card cx-card--wide"
      aria-labelledby="cx-more-credits"
      aria-busy={result.isPending}
    >
      <div className="cx-card__head">
        <h2 id="cx-more-credits" className="cx-card__title">
          {t('moreCredits.title')}
        </h2>
        {result.data && result.data.collaborators.length > 0 && (
          <span className="cx-card__count">
            {result.data.collaborators.length}
          </span>
        )}
      </div>
      <p className="cx-card__note">{t('moreCredits.lead')}</p>
      {result.isPending && (
        <>
          <p className="cx-card__note" role="status">
            {t('moreCredits.loading')}
          </p>
          <span className="skeleton cx-skel-card sx-skel" aria-hidden="true" />
        </>
      )}
      {result.isError && (
        <p className="cx-card__empty">{t('moreCredits.failed')}</p>
      )}
      {result.data && <Body data={result.data} names={names} />}
    </section>
  );
}
