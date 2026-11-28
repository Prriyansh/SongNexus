'use client';

import { useEffect, useState } from 'react';
import { CircleUserRound } from 'lucide-react';
import { readStoredProfile, storeProfile } from './profile';
import { buildPath, comparisonFor, defaultWeb, parseRoute } from './routing';
import type { Comparison, Route, WebSelection } from './routing';
import { applyAnswers, needsSetup, playlistFrom, readSetup, storeSetup } from './setup';
import type { SetupAnswers } from './setup';
import { readStoredPlaylist, storePlaylist } from './taste';
import type { EntityType, Selection } from './types';
import { AboutMe } from './components/AboutMe';
import { Footer, Sidebar, TopBar } from './components/AppFrame';
import { ConnectionWeb } from './components/ConnectionWeb';
import { DetailDrawer } from './components/DetailDrawer';
import { Explore } from './components/Explore';
import { ShareModal } from './components/ShareModal';
import { TasteSetup } from './components/TasteSetup';
import { Friends } from './components/TasteWeb';

/** Closes the navigation menu on Escape while it's open. */
function useEscapeToClose(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [open, setOpen]);
}

function App() {
  const [profile, setProfile] = useState(readStoredProfile);
  useEffect(() => {
    storeProfile(profile);
  }, [profile]);
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [web, setWeb] = useState(() => route.web ?? defaultWeb());
  const [setup, setSetup] = useState(readSetup);
  const [detail, setDetail] = useState<Selection | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { page, comparison, note } = route;
  useEscapeToClose(menuOpen, setMenuOpen);

  // A bare /compare/artists link gets the default pair written into the URL, so it can be shared.
  useEffect(() => {
    if (route.page === 'about' || route.page === 'friends') return; // Friends links carry a code or playlist to read.
    const path = buildPath(route.page, route.comparison, route.note, false, route.web);
    // The hash holds a friend's playlist on the Connection Web, so it's kept.
    if (window.location.pathname + window.location.search !== path) window.history.replaceState(null, '', path + window.location.hash);
    // Only on first load; later changes go through go().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeOverlays = () => {
    setDetail(null);
    setShareOpen(false);
    setMenuOpen(false);
  };

  // Back/forward restore the page and comparison from the URL.
  useEffect(() => {
    const handle = () => {
      const next = parseRoute(window.location.pathname, window.location.search);
      setRoute((current) => (next.page === 'about' || next.page === 'connections' ? { ...next, comparison: current.comparison } : next));
      if (next.web) setWeb(next.web);
      setDetail(null);
      setShareOpen(false);
      setMenuOpen(false);
    };
    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, []);

  /** Every navigation: the URL first (a new history entry unless `replace`), then the state. */
  const go = (next: Route, { replace = false, scroll = true } = {}) => {
    const path = buildPath(next.page, next.comparison, next.note, next.manual, next.web ?? web);
    if (replace) window.history.replaceState(null, '', path);
    else window.history.pushState(null, '', path);
    setRoute(next);
    if (next.web) setWeb(next.web);
    closeOverlays();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const navigate = (p: Route['page']) => go({ page: p, manual: false, comparison, web, note: '' });
  const explore = (next: Comparison, options?: { scroll: boolean }) => go({ page: 'explore', manual: false, comparison: next, note: '' }, options);
  const openWeb = (next: WebSelection) => go({ page: 'connections', manual: false, comparison, web: next, note: '' });
  const compareFrom = (kind: EntityType, id: string) => {
    const keep = comparison.kind === kind ? (comparison.left !== id ? comparison.left : comparison.right) : undefined;
    explore(comparisonFor(kind, id, keep));
  };

  const shared = page === 'about' ? route.profile : undefined;
  // First visit only: the setup questions. Shared profiles and deep links never ask.
  const showSetup = page === 'about' && !shared && !route.manual && needsSetup(profile, setup);
  const finishSetup = (answers: SetupAnswers) => {
    const nextProfile = applyAnswers(profile, answers);
    const nextSetup = { done: true, name: answers.name.trim(), discover: answers.discover };
    setProfile(nextProfile);
    setSetup(nextSetup);
    storeSetup(nextSetup);
    const songs = playlistFrom(nextProfile);
    const top = nextProfile.artists[0];
    if (answers.discover === 'friends') go({ page: 'friends', manual: false, comparison, web, note: '' });
    else if (answers.discover === 'new' && songs.length) {
      if (!readStoredPlaylist()) storePlaylist({ name: nextSetup.name, songs });
      openWeb({ ...web, mode: 'playlist' });
    } else if (answers.discover && top) openWeb({ ...web, mode: 'artist', artist: top.id });
  };

  const onWeb = page === 'connections' || page === 'friends';
  const content = () => {
    switch (page) {
      case 'about':
        return (
          <>
            {shared && <SharedProfileNote note={note} onOwn={() => navigate('about')} />}
            <AboutMe
              key={shared ? 'shared' : 'own'}
              onSelect={setDetail}
              profile={shared || profile}
              onProfileChange={setProfile}
              readOnly={!!shared}
              manual={route.manual}
              onManual={(open) => go({ ...route, manual: open, profile: undefined, note: '' }, { scroll: false })}
              name={shared ? '' : setup.name}
            />
          </>
        );
      case 'friends':
        return (
          <Friends
            profile={profile}
            onExploreArtist={(artist) => openWeb({ ...web, mode: 'artist', artist })}
            onExploreSong={(song) => openWeb({ ...web, mode: 'song', song })}
            onDetails={setDetail}
          />
        );
      case 'connections':
        return (
          <ConnectionWeb
            selection={web}
            onChange={(next) => go({ ...route, web: next, note: '' }, { scroll: false })}
            onSelect={setDetail}
            onCompare={(kind, a, b) => explore(comparisonFor(kind, a, b))}
            note={note}
            profile={profile}
          />
        );
      default:
        return (
          <Explore
            comparison={comparison}
            onComparison={(next) => explore(next, { scroll: false })}
            onRole={(role) => go({ ...route, comparison: { ...comparison, role } }, { replace: true, scroll: false })}
            onDetails={setDetail}
            note={note}
            onDismissNote={() => go({ ...route, note: '' }, { replace: true, scroll: false })}
            profile={profile}
          />
        );
    }
  };

  return (
    <div className={`app-shell ${onWeb ? 'is-connection-web' : ''}`}>
      <Sidebar page={page} open={menuOpen} onClose={() => setMenuOpen(false)} onNavigate={navigate} />
      <div className="page-column">
        <TopBar page={page} onMenu={() => setMenuOpen(true)} onHome={() => navigate('about')} onShare={() => setShareOpen(true)} />
        <main className={`main-content ${onWeb ? 'web-main-content' : ''}`}>
          {content()}
          {!onWeb && <Footer />}
        </main>
      </div>
      {detail && (
        <DetailDrawer
          selected={detail}
          onClose={() => setDetail(null)}
          onSelect={setDetail}
          profile={profile}
          onProfileChange={setProfile}
          onCompare={compareFrom}
        />
      )}
      {shareOpen && <ShareModal route={{ ...route, web }} profile={shared || profile} onClose={() => setShareOpen(false)} />}
      {showSetup && <TasteSetup onFinish={finishSetup} />}
    </div>
  );
}

function SharedProfileNote({ note, onOwn }: { note: string; onOwn: () => void }) {
  return (
    <div className="shared-note">
      <CircleUserRound size={20} />
      <div>
        <strong>Shared About Me</strong>
        <p>{note || 'You’re viewing a shared music taste profile.'}</p>
      </div>
      <button className="secondary-button" onClick={onOwn}>
        View my About Me
      </button>
    </div>
  );
}

export default App;
