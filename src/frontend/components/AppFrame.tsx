// Helen's frame around every page: the sidebar, the top bar and the footer.
import type { ReactNode } from 'react';
import { ChevronRight, CircleUserRound, Compass, Menu, Music2, Network, Share2, Users } from 'lucide-react';
import { SidebarLinks } from '@/discover/components/SidebarLinks';
import type { Route } from '../routing';

type Page = Route['page'];

/** The app's pages, in sidebar order, with their names and icons. */
export const PAGES: { page: Page; name: string; icon: ReactNode }[] = [
  { page: 'about', name: 'About Me', icon: <CircleUserRound size={22} /> },
  { page: 'connections', name: 'Connection Web', icon: <Network size={22} /> },
  { page: 'friends', name: 'Friends', icon: <Users size={22} /> },
  { page: 'explore', name: 'Explore', icon: <Compass size={22} /> },
];

export const pageName = (page: Page) => PAGES.find((p) => p.page === page)!.name;

type SidebarProps = { page: Page; open: boolean; onClose: () => void; onNavigate: (page: Page) => void };

export function Sidebar({ page, open, onClose, onNavigate }: SidebarProps) {
  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'visible' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <button className="brand" onClick={() => onNavigate('about')} aria-label="Song Nexus home">
          <span className="brand-mark">
            <Music2 size={28} strokeWidth={2.5} />
          </span>
          <span>
            <strong>SONG NEXUS</strong>
          </span>
        </button>
        <div className="sidebar-navigation">
          <span className="nav-caption">YOUR WORKSPACE</span>
          <nav aria-label="Main navigation">
            {PAGES.map(({ page: target, name, icon }) => (
              <button
                key={target}
                className={`nav-option ${page === target ? 'active' : ''}`}
                aria-label={name}
                aria-current={page === target ? 'page' : undefined}
                onClick={() => onNavigate(target)}
              >
                {icon}
                <span>{name}</span>
                {page === target && <span className="nav-track" />}
              </button>
            ))}
            <SidebarLinks />
          </nav>
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-dot" />
            MUSICBRAINZ<span>v2.0</span>
          </div>
        </div>
      </aside>
    </>
  );
}

type TopBarProps = { page: Page; onMenu: () => void; onHome: () => void; onShare: () => void };

export function TopBar({ page, onMenu, onHome, onShare }: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Open navigation">
          <Menu size={23} />
        </button>
        <button className="header-wordmark" onClick={onHome} aria-label="Song Nexus home">
          <Music2 size={21} /> SONG NEXUS<span></span>
        </button>
        <ChevronRight size={15} />
        <strong>{pageName(page)}</strong>
      </div>
      <div className="topbar-right">
        <button className="top-share" aria-label="Share" onClick={onShare}>
          <Share2 size={17} />
          <span>Share</span>
        </button>
      </div>
    </header>
  );
}

const SOURCES: [string, string][] = [
  ['MusicBrainz', 'https://musicbrainz.org'],
  ['Cover Art Archive', 'https://coverartarchive.org'],
  ['Deezer', 'https://www.deezer.com'],
  ['Wikidata', 'https://www.wikidata.org'],
  ['Wikipedia', 'https://en.wikipedia.org'],
  ['ListenBrainz', 'https://listenbrainz.org'],
  ['Last.fm', 'https://www.last.fm'],
  ['Genius', 'https://genius.com'],
  ['Discogs', 'https://www.discogs.com'],
  ['Spotify tracks dataset', 'https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset'],
];

/** A link to a source by its name in `SOURCES`. */
function Source({ name }: { name: string }) {
  const [, url] = SOURCES.find(([n]) => n === name)!;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {name}
    </a>
  );
}

/** Credits every source the app shows data from. */
export function Footer() {
  return (
    <footer>
      <span>SONG NEXUS</span>
      <span>
        Data from <Source name="MusicBrainz" /> and the <Source name="Cover Art Archive" />; top songs, related artists and artist photos
        from <Source name="Deezer" />; artist facts from <Source name="Wikidata" />, <Source name="Wikipedia" /> (CC BY-SA),{' '}
        <Source name="ListenBrainz" /> and <Source name="Last.fm" />; more credits from <Source name="Genius" /> and{' '}
        <Source name="Discogs" />; sound from the <Source name="Spotify tracks dataset" /> and Genius lyrics.
      </span>
    </footer>
  );
}
