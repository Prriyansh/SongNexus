// First-visit questions that fill About Me: genres, artists, songs, how you like to discover
// music, and your name. Every step can be skipped; closing keeps what was picked.
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Compass, Plus, Search, Sparkles, Users, X } from 'lucide-react';
import type { Artist, Song } from '@/lib/types';
import { searchArtists, searchSongs } from '../api';
import { genreFamilies } from '../genres';
import { artistSubtitle, capitalize, songArtists } from '../model';
import type { Discover, SetupAnswers } from '../setup';
import { Modal } from './Modal';

const STEPS = ['genres', 'artists', 'songs', 'discover', 'name'] as const;
const DISCOVER: { value: Discover; title: string; text: string; icon: typeof Compass }[] = [
  { value: 'similar', title: 'Similar to what I love', text: 'Open the Connection Web around your top artist.', icon: Compass },
  { value: 'new', title: 'Something new for me', text: 'Map your songs and show artists that are new to you.', icon: Sparkles },
  { value: 'friends', title: 'Compare with friends', text: 'Share a code and put two playlists on one map.', icon: Users },
];

type Found<T> = { key: string; items?: T[]; error?: string };

/** Search MusicBrainz and toggle results; picks stay listed above the results. */
function SearchPicks<T extends Artist | Song>({ kind, picked, onChange }: { kind: 'artist' | 'song'; picked: T[]; onChange: (next: T[]) => void }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found<T>>({ key: '' });
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const request = (kind === 'artist' ? searchArtists(q, controller.signal, 8) : searchSongs(q, controller.signal, 8)) as Promise<T[]>;
      request.then(
        items => { if (!controller.signal.aborted) setFound({ key: q, items }); },
        error => { if (!controller.signal.aborted) setFound({ key: q, error: error instanceof Error ? error.message : 'Search failed.' }); },
      );
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [kind, q]);
  const label = (item: T) => 'title' in item ? item.title : item.name;
  const detail = (item: T) => 'title' in item ? songArtists(item) : item.disambiguation || artistSubtitle(item);
  const has = (item: T) => picked.some(p => p.id === item.id);
  const toggle = (item: T) => onChange(has(item) ? picked.filter(p => p.id !== item.id) : [...picked, item]);
  const results = found.key === q ? found.items ?? [] : [];
  const searching = q.length >= 2 && found.key !== q;
  return <>
    {!!picked.length && <div className="setup-picked" aria-label={`Your ${kind}s`}>{picked.map(item => <button key={item.id} className="setup-chip is-on" onClick={() => toggle(item)} aria-label={`Remove ${label(item)}`}>{label(item)} <X size={12} /></button>)}</div>}
    <label className="input-search"><Search size={18} /><input aria-label={kind === 'artist' ? 'Search artists' : 'Search songs'} placeholder={kind === 'artist' ? 'Search for an artist…' : 'Search for a song…'} value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="setup-results" aria-busy={searching}>
      {searching && <p className="setup-hint">Searching MusicBrainz…</p>}
      {found.key === q && found.error && <p className="error-text" role="alert">{found.error}</p>}
      {found.key === q && !found.error && !results.length && <p className="setup-hint">No matches for “{q}”.</p>}
      {results.map(item => <button key={item.id} className={`setup-result ${has(item) ? 'is-on' : ''}`} aria-pressed={has(item)} onClick={() => toggle(item)}>
        <span><strong>{label(item)}</strong><small>{detail(item)}</small></span>{has(item) ? <Check size={16} /> : <Plus size={16} />}
      </button>)}
    </div>
  </>;
}

export function TasteSetup({ onFinish }: { onFinish: (answers: SetupAnswers) => void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<SetupAnswers>({ name: '', genres: [], artists: [], songs: [], discover: null });
  const update = (next: Partial<SetupAnswers>) => setAnswers(current => ({ ...current, ...next }));
  const current = STEPS[step];
  const last = step === STEPS.length - 1;
  const next = () => (last ? onFinish(answers) : setStep(step + 1));
  const toggleGenre = (genre: string) => update({ genres: answers.genres.includes(genre) ? answers.genres.filter(g => g !== genre) : [...answers.genres, genre] });
  const answered = current === 'genres' ? answers.genres.length > 0 : current === 'artists' ? answers.artists.length > 0
    : current === 'songs' ? answers.songs.length > 0 : current === 'discover' ? !!answers.discover : !!answers.name.trim();

  // Closing keeps what was picked but doesn't move you to another page.
  return <Modal label="Set up your music taste" onClose={() => onFinish({ ...answers, discover: null })}>
    <div className="taste-setup">
      <div className="modal-heading"><span className="setup-step">Step {step + 1} of {STEPS.length}</span><button className="icon-button" onClick={() => onFinish({ ...answers, discover: null })} aria-label="Skip setup"><X size={19} /></button></div>
      <div className="setup-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      {current === 'genres' && <><h2>Which genres do you love?</h2><p>Pick a few. Search puts music in these genres first.</p>
        <div className="setup-genres">{Object.entries(genreFamilies).map(([family, genres]) => <div key={family}><span className="field-label">{family}</span><div className="setup-chips">{genres.map(g => <button key={g} className={`setup-chip ${answers.genres.includes(g) ? 'is-on' : ''}`} aria-pressed={answers.genres.includes(g)} onClick={() => toggleGenre(g)}>{capitalize(g)}</button>)}</div></div>)}</div></>}
      {current === 'artists' && <><h2>Name 3 artists you have on repeat.</h2><p>We’ll add them to About Me.</p><SearchPicks kind="artist" picked={answers.artists} onChange={artists => update({ artists })} /></>}
      {current === 'songs' && <><h2>Pick a few songs you can’t stop playing.</h2><p>Optional. Friends can fill in your playlist from these.</p><SearchPicks kind="song" picked={answers.songs} onChange={songs => update({ songs })} /></>}
      {current === 'discover' && <><h2>How do you like to discover music?</h2><p>We’ll take you there when you’re done.</p>
        <div className="setup-options">{DISCOVER.map(({ value, title, text, icon: Icon }) => <button key={value} className={`setup-option ${answers.discover === value ? 'is-on' : ''}`} aria-pressed={answers.discover === value} onClick={() => update({ discover: answers.discover === value ? null : value })}><Icon size={20} /><span><strong>{title}</strong><small>{text}</small></span></button>)}</div></>}
      {current === 'name' && <><h2>What should we call you?</h2><p>Optional. Shown on About Me and to friends you compare with.</p>
        <label className="field-label" htmlFor="setup-name">YOUR NAME</label><input id="setup-name" className="setup-name" maxLength={40} value={answers.name} onChange={e => update({ name: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') next(); }} placeholder="Your name" /></>}
      <div className="setup-actions">
        {step > 0 && <button className="secondary-button" onClick={() => setStep(step - 1)}><ArrowLeft size={15} /> Back</button>}
        <button className="text-cta" onClick={next}>{last ? 'Skip and finish' : 'Skip'}</button>
        <button className="primary-button" disabled={!answered} onClick={next}>{last ? <><Check size={15} /> Finish</> : <>Next <ArrowRight size={15} /></>}</button>
      </div>
    </div>
  </Modal>;
}
