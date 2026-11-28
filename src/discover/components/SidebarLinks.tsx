import { BookOpen, Gamepad2, Library, MessageCircleQuestion, Route, Search, Spline, Waypoints } from "lucide-react";

/** Discover's entries in the sidebar, after the app's own four. */
export const DISCOVER_LINKS = [
  { href: "/discover", label: "Discover", Icon: Search },
  { href: "/discover/six-degrees", label: "Six Degrees", Icon: Spline },
  { href: "/discover/connections", label: "Collaborators", Icon: Waypoints },
  { href: "/discover/stories", label: "Stories", Icon: BookOpen },
  { href: "/discover/ask", label: "Ask", Icon: MessageCircleQuestion },
  { href: "/discover/games", label: "Games", Icon: Gamepad2 },
  { href: "/discover/library", label: "Library", Icon: Library },
  { href: "/discover/friends", label: "Friend paths", Icon: Route },
] as const;

/** Which entry a page belongs to; artist, song, label and genre pages belong to Discover. */
export function currentLink(pathname: string | null) {
  if (!pathname?.startsWith("/discover")) return null;
  return (
    DISCOVER_LINKS.find(({ href }) => href === pathname) ??
    DISCOVER_LINKS.find(({ href }) => href !== "/discover" && pathname.startsWith(`${href}/`)) ??
    DISCOVER_LINKS[0]
  );
}

/** Plain links: each side of the app reads the address when it loads. */
export function SidebarLinks({ pathname = null }: { pathname?: string | null }) {
  const current = currentLink(pathname);
  return DISCOVER_LINKS.map((link) => (
    <a
      key={link.href}
      className={`nav-option ${link === current ? "active" : ""}`}
      href={link.href}
      aria-label={link.label}
      aria-current={link === current ? "page" : undefined}
    >
      <link.Icon size={22} />
      <span>{link.label}</span>
      {link === current && <span className="nav-track" />}
    </a>
  ));
}
