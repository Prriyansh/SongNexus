"use client";

import {
  ChevronRight,
  CircleUserRound,
  Compass,
  Menu,
  Music2,
  Network,
  Users,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import AccountSync from "./AccountSync";
import { currentLink, SidebarLinks } from "./SidebarLinks";
import { AppLink } from "./parts";

// The app's own screens, as its sidebar lists them (PAGES in src/frontend/components/AppFrame.tsx).
const APP_LINKS = [
  { href: "/about", label: "About Me", Icon: CircleUserRound },
  { href: "/connections", label: "Connection Web", Icon: Network },
  { href: "/friends", label: "Friends", Icon: Users },
  { href: "/compare/artists", label: "Explore", Icon: Compass },
];

const CurrentLinks = () => <SidebarLinks pathname={usePathname()} />;
const CurrentTitle = () => currentLink(usePathname())?.label ?? "Discover";

/** Tells the shell a new page has arrived. */
function OnArrival({ onArrive }: { onArrive: () => void }) {
  const pathname = usePathname();
  useEffect(onArrive, [pathname, onArrive]);
  return null;
}

/** A plain left click on a link to another Discover page: the ones that load without a reload. */
function leadsToPage(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='/discover']");
  return link !== null && link.target !== "_blank" && link.pathname !== window.location.pathname;
}

/** The app's sidebar and top bar around Discover's pages, with the app's own class names. */
/** `accounts`: sign-in is set up, so a signed-in person's data is kept in step. */
export default function DiscoverShell({ children, accounts = false }: { children: ReactNode; accounts?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [arrive] = useState(() => () => {
    setLeaving(false);
    setMenuOpen(false);
  });
  const menuButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const returnTo = menuButton.current;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo?.focus();
    };
  }, [menuOpen]);

  return (
    <div
      className="app-shell dx-shell"
      onClickCapture={(event) => {
        if (leadsToPage(event)) setLeaving(true);
      }}
    >
      <a className="dx-skip" href="#discover-main">
        Skip to content
      </a>
      <div className="dx-progress" data-on={leaving || undefined} aria-hidden="true" />
      <Suspense>
        <OnArrival onArrive={arrive} />
      </Suspense>
      <div
        className={`sidebar-backdrop ${menuOpen ? "visible" : ""}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`} aria-label="Song Nexus">
        <AppLink href="/" className="brand">
          <span className="brand-mark">
            <Music2 size={28} strokeWidth={2.5} />
          </span>
          <span>
            <strong>SONG NEXUS</strong>
          </span>
        </AppLink>
        {menuOpen && (
          <button
            ref={closeButton}
            type="button"
            className="dx-menu-close"
            onClick={() => setMenuOpen(false)}
            aria-label="Close navigation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        )}
        <div className="sidebar-navigation">
          <span className="nav-caption">YOUR WORKSPACE</span>
          <nav aria-label="Main navigation">
            {APP_LINKS.map(({ href, label, Icon }) => (
              <a key={href} className="nav-option" href={href} aria-label={label}>
                <Icon size={22} />
                <span>{label}</span>
              </a>
            ))}
            {/* Prerendering doesn't know the address, so the mark for "here" comes after. */}
            <Suspense fallback={<SidebarLinks />}>
              <CurrentLinks />
            </Suspense>
          </nav>
        </div>
      </aside>
      <div className="page-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              ref={menuButton}
              type="button"
              className="icon-button mobile-menu"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              aria-expanded={menuOpen}
            >
              <Menu size={23} />
            </button>
            <AppLink href="/" className="header-wordmark">
              <Music2 size={21} /> SONG NEXUS
            </AppLink>
            <ChevronRight size={15} aria-hidden="true" />
            <strong>
              <Suspense fallback="Discover">
                <CurrentTitle />
              </Suspense>
            </strong>
          </div>
        </header>
        {accounts && <AccountSync />}
        {children}
      </div>
    </div>
  );
}
