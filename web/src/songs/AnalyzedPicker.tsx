/**
 * Song pickers that offer songs with the full sound and lyrics analysis (Priyansh's song
 * pickers in the team app): search the sound dataset, keep only songs our catalog also has,
 * and fill the next empty side of the comparison.
 */
import {useDeferredValue, useId, useState} from 'react';
import {useQuery} from '@tanstack/react-query';

import {api, idOf, unwrap} from '../api/client';
import {Icon} from '../components/Icon';
import {useI18n} from '../i18n/i18n';

function useSoundSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: ['soundSearch', q],
    queryFn: () =>
      unwrap(
        api.GET('/v1/sound:search', {
          params: {query: {query: q, pageSize: 10}},
        }),
      ),
    enabled: q.length >= 2,
    staleTime: 30 * 60_000,
  });
}

export function AnalyzedPicker({onPick}: {onPick: (id: string) => void}) {
  const {t} = useI18n();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const search = useSoundSearch(deferred);
  const id = useId();
  const data = search.data;
  return (
    <section className="cx-card analyzed" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="cx-card__title">
        <Icon name="spark" />
        {t('songCompare.analyzed.title')}
      </h2>
      <p className="cx-card__note">{t('songCompare.analyzed.lead')}</p>
      <label className="search-pill analyzed__search">
        <Icon name="search" />
        <span className="visually-hidden">
          {t('songCompare.analyzed.label')}
        </span>
        <input
          type="search"
          autoComplete="off"
          placeholder={t('songCompare.analyzed.placeholder')}
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
      </label>
      {data?.status === 'UNAVAILABLE' && (
        <p className="cx-card__empty">
          {t('songCompare.analyzed.unavailable')}
        </p>
      )}
      {data?.status === 'OK' && data.results.length === 0 && (
        <p className="cx-card__empty">{t('songCompare.analyzed.none')}</p>
      )}
      {data && data.results.length > 0 && (
        <ul className="analyzed__list">
          {data.results.map(hit => (
            <li key={hit.recording}>
              <button
                type="button"
                className="analyzed__hit"
                onClick={() => onPick(idOf(hit.recording))}
              >
                <strong>{hit.title}</strong>
                <span>{hit.artists.join(', ')}</span>
                <small>
                  {hit.hasLyrics
                    ? t('songCompare.analyzed.full')
                    : t('songCompare.analyzed.sound')}
                  {hit.genre ? ` · ${hit.genre}` : ''}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
