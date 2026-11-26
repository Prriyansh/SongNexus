import { useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { ArrowUpRight, Check, GitCompareArrows, Heart, Info, X } from 'lucide-react';
import type { ArtistDetails, LinkRef, RecordingDetails } from '@/lib/types';
import { formatDuration } from '@/lib/types';
import { detailsOf } from '../api';
import {
  albumSampleNote, artistCover, artistSubtitle, capitalize, lifeSpanLabels, linkLabel, musicBrainzUrl,
  recentAlbums, songArtists, studioAlbumText, uniqueLinks,
} from '../model';
import { albumSnapshot, artistSnapshot, songSnapshot } from '../profile';
import type { MusicProfile, SavedAlbum } from '../profile';
import type { EntityType, Selection } from '../types';
import { useAsync } from '../useAsync';
import { useTaste } from './AboutMe';
import { AlbumCover, ArtistAvatar } from './Artwork';
import { LoadError } from './LoadError';
import { MiniArtist } from './MiniArtist';
import { Modal } from './Modal';

type Props = {
  selected: Selection;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  profile: MusicProfile;
  onProfileChange: Dispatch<SetStateAction<MusicProfile>>;
  onCompare: (kind: EntityType, id: string) => void;
};

type Taste = ReturnType<typeof useTaste>;

/** The side drawer for an artist, a song or a saved album, opened from anywhere in the app. */
export function DetailDrawer({ selected, onClose, onSelect, profile, onProfileChange, onCompare }: Props) {
  const [notice, setNotice] = useState('');
  const taste = useTaste(profile, onProfileChange, setNotice);
  const kind = selected.type === 'album' ? null : selected.type;
  const state = useAsync(kind && `${kind}:${selected.id}`, () => detailsOf(kind!, selected.id));

  const body = () => {
    if (selected.type === 'album') return <AlbumBody album={selected.album} profile={profile} taste={taste} onSelect={onSelect} />;
    if (state.error) return <LoadError error={state.error} retry={state.retry} />;
    if (!state.data) return <Loading />;
    return selected.type === 'artist' ? (
      <ArtistBody artist={state.data as ArtistDetails} profile={profile} taste={taste} onCompare={onCompare} />
    ) : (
      <SongBody song={state.data as RecordingDetails} profile={profile} taste={taste} onCompare={onCompare} onSelect={onSelect} />
    );
  };
  const label = { album: 'Album details', artist: 'Artist details', song: 'Song details' }[selected.type];

  return (
    <Modal drawer onClose={onClose} label={label}>
      <div className="drawer-top">
        <button className="icon-button" onClick={onClose} aria-label="Close details">
          <X size={19} />
        </button>
      </div>
      {body()}
      {notice ? (
        <div className="drawer-tip" role="status">
          <Check size={16} /> {notice}
        </div>
      ) : (
        <div className="drawer-tip">
          <Info size={16} /> Select any artist above to keep exploring without leaving the comparison.
        </div>
      )}
    </Modal>
  );
}

function Loading() {
  return (
    <div className="drawer-hero" aria-busy="true">
      <div className="skeleton-lines">
        <span />
        <span />
        <span />
      </div>
      <p className="loading-text">Loading from MusicBrainz…</p>
    </div>
  );
}

/** Adds to or removes from About Me, saying which it would do. */
function TasteButton({ added, onClick }: { added: boolean; onClick: () => void }) {
  return (
    <button className={`secondary-button ${added ? 'is-saved' : ''}`} onClick={onClick}>
      <Heart size={15} fill={added ? 'currentColor' : 'none'} /> {added ? 'In your taste' : 'Add to your taste'}
    </button>
  );
}

function CompareButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="secondary-button" onClick={onClick}>
      <GitCompareArrows size={15} /> Compare
    </button>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="drawer-section">
      <div className="drawer-section-heading">
        <h3>{title}</h3>
        {aside !== undefined && <span>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function ExternalLink({ href, title, small }: { href: string; title: string; small: string }) {
  return (
    <a className="mini-entity" href={href} target="_blank" rel="noreferrer">
      <span>
        <strong>{title}</strong>
        <small>{small}</small>
      </span>
      <ArrowUpRight size={15} />
    </a>
  );
}

function LinkPills({ title, links }: { title: string; links: LinkRef[] }) {
  if (!links.length) return null;
  return (
    <Section title={title}>
      <div className="link-pills">
        {uniqueLinks(links).map((link) => (
          <a key={link.url} href={link.url} target="_blank" rel="noreferrer">
            {linkLabel(link)} ↗
          </a>
        ))}
      </div>
    </Section>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Chips({ names }: { names: string[] }) {
  return (
    <div className="chip-row">
      {names.slice(0, 5).map((name) => (
        <span className="chip" key={name}>
          {capitalize(name)}
        </span>
      ))}
    </div>
  );
}

function AlbumBody({ album, profile, taste, onSelect }: { album: SavedAlbum; profile: MusicProfile; taste: Taste; onSelect: (s: Selection) => void }) {
  const artistId = album.artistId;
  return (
    <>
      <div className="drawer-hero">
        <AlbumCover cover={album} size="lg" />
        <h2>{album.title}</h2>
        <p>
          {album.artist}
          {album.year ? ` · ${album.year}` : ''}
        </p>
      </div>
      <div className="drawer-actions">
        <TasteButton added={profile.albums.some((x) => x.id === album.id)} onClick={() => taste.album(album)} />
        <a className="secondary-button" href={musicBrainzUrl('release-group', album.id)} target="_blank" rel="noreferrer">
          View on MusicBrainz <ArrowUpRight size={14} />
        </a>
      </div>
      {artistId && (
        <Section title="Artist">
          <MiniArtist artist={{ id: artistId, name: album.artist }} onClick={() => onSelect({ type: 'artist', id: artistId })} />
        </Section>
      )}
    </>
  );
}

function ArtistBody({ artist: a, profile, taste, onCompare }: { artist: ArtistDetails; profile: MusicProfile; taste: Taste; onCompare: (kind: EntityType, id: string) => void }) {
  const labels = lifeSpanLabels(a.type);
  const albums = recentAlbums(a.discography?.representative ?? []);
  return (
    <>
      <div className="drawer-hero">
        <ArtistAvatar artist={{ ...a, artUrl: artistCover(a) }} size="lg" />
        <h2>{a.name}</h2>
        <p>{artistSubtitle(a)}</p>
        <Chips names={a.genres.map((g) => g.name)} />
      </div>
      {a.disambiguation && <p className="drawer-description">{a.disambiguation}</p>}
      <div className="drawer-actions">
        <TasteButton added={profile.artists.some((x) => x.id === a.id)} onClick={() => taste.artist(artistSnapshot(a))} />
        <CompareButton onClick={() => onCompare('artist', a.id)} />
      </div>
      <div className="drawer-stats">
        <Stat label={labels.begin} value={a.lifeSpan.begin || '—'} />
        <Stat label="From" value={a.area || a.country || '—'} />
        <Stat label="Studio albums" value={studioAlbumText(a)} />
        <Stat label="Rating" value={a.rating ? `${a.rating.value.toFixed(1)} / 5 (${a.rating.votes})` : '—'} />
      </div>
      <Section title="Studio albums" aside={albumSampleNote(a) || 'newest first'}>
        {albums.length ? (
          albums.map((album) => {
            const added = profile.albums.some((x) => x.id === album.id);
            return (
              <div className="album-row" key={album.id}>
                <a className="mini-entity" href={musicBrainzUrl('release-group', album.id)} target="_blank" rel="noreferrer">
                  <AlbumCover cover={album} size="sm" />
                  <span>
                    <strong>{album.title}</strong>
                    <small>{album.year || 'Year unknown'}</small>
                  </span>
                  <ArrowUpRight size={15} />
                </a>
                <button
                  className="icon-button"
                  aria-pressed={added}
                  aria-label={`${added ? 'Remove' : 'Add'} ${album.title} ${added ? 'from' : 'to'} your taste`}
                  onClick={() => taste.album(albumSnapshot(album, a))}
                >
                  <Heart size={15} fill={added ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })
        ) : (
          <p>No studio albums listed on MusicBrainz.</p>
        )}
      </Section>
      <LinkPills title="Listen & learn more" links={a.links} />
    </>
  );
}

function SongBody({ song: s, profile, taste, onCompare, onSelect }: { song: RecordingDetails; profile: MusicProfile; taste: Taste; onCompare: (kind: EntityType, id: string) => void; onSelect: (s: Selection) => void }) {
  return (
    <>
      <div className="drawer-hero">
        <AlbumCover cover={{ id: s.id, artUrl: s.representative?.artUrl }} size="lg" />
        <h2>{s.title}</h2>
        <p>
          {songArtists(s)}
          {s.representative ? ` · ${s.representative.title}` : ''}
        </p>
        <Chips names={s.genres.length ? s.genres.map((g) => g.name) : s.tags} />
      </div>
      {s.disambiguation && <p className="drawer-description">{s.disambiguation}</p>}
      <div className="drawer-actions">
        <TasteButton added={profile.songs.some((x) => x.id === s.id)} onClick={() => taste.song(songSnapshot(s))} />
        <CompareButton onClick={() => onCompare('song', s.id)} />
      </div>
      <div className="drawer-stats three">
        <Stat label="Released" value={s.firstReleaseDate || '—'} />
        <Stat label="Length" value={s.durationMs == null ? '—' : formatDuration(s.durationMs)} />
        <Stat label="Rating" value={s.rating ? `${s.rating.value.toFixed(1)} / 5` : '—'} />
      </div>
      <Section title="Credited artists" aside={s.artists.length}>
        {s.artists.map(({ id, name }) =>
          id ? (
            <div className="relation" key={id}>
              <span className="relation-type">Artist</span>
              <MiniArtist artist={{ id, name }} onClick={() => onSelect({ type: 'artist', id })} />
            </div>
          ) : (
            <p key={name}>{name}</p>
          ),
        )}
      </Section>
      {!!s.releases.length && (
        <Section title="Appears on">
          {s.releases.map((r) => (
            <ExternalLink key={r.id} href={musicBrainzUrl('release', r.id)} title={r.title} small={r.date || 'Date unknown'} />
          ))}
        </Section>
      )}
      <LinkPills title="Listen" links={s.links} />
    </>
  );
}
