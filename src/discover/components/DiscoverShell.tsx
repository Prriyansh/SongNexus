"use client";

import { ChevronRight, CircleUserRound, Compass, Menu, Music2, Network, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { currentLink, SidebarLinks } from "./SidebarLinks";
import { AppLink } from "./parts";

// The app's own screens, as its sidebar lists them (src/frontend/App.tsx).
const APP_LINKS = [
  { href: "/about", label: "About Me", Icon: CircleUserRound },
  { href: "/connections", label: "Connection Web", Icon: Network },
  { href: "/friends", label: "Friends", Icon: Users },
  { href: "/compare/artists", label: "Explore", Icon: Compass },
];

const CurrentLinks = () => <SidebarLinks pathname={usePathname()} />;
const CurrentTitle = () => currentLink(usePathname())?.label ?? "Discover";

/** The app's sidebar and top bar around Discover's pages, with the app's own class names. */
export default function DiscoverShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="app-shell dx-shell">
      <div className={`sidebar-backdrop ${menuOpen ? "visible" : ""}`} onClick={() => setMenuOpen(false)} />
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <AppLink href="/" className="brand">
          <span className="brand-mark"><Music2 size={28} strokeWidth={2.5} /></span>
          <span><strong>SONG NEXUS</strong></span>
        </AppLink>
        <div className="sidebar-navigation">
          <span className="nav-caption">YOUR WORKSPACE</span>
          <nav aria-label="Main navigation">
            {APP_LINKS.map(({ href, label, Icon }) => (
              <a key={href} className="nav-option" href={href} aria-label={label}><Icon size={22} /><span>{label}</span></a>
            ))}
            {/* The address isn't known while a page is prerendered, so the mark for "here" comes after. */}
            <Suspense fallback={<SidebarLinks />}><CurrentLinks /></Suspense>
          </nav>
        </div>
      </aside>
      <div className="page-column">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu size={23} /></button>
            <AppLink href="/" className="header-wordmark"><Music2 size={21} /> SONG NEXUS</AppLink>
            <ChevronRight size={15} />
            <strong><Suspense fallback="Discover"><CurrentTitle /></Suspense></strong>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
