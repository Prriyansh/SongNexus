"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppLink } from "./parts";

const ITEMS = [
  { href: "/discover", label: "Home" },
  { href: "/discover/six-degrees", label: "Six Degrees" },
  { href: "/discover/connections", label: "Connections" },
];

export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="dx-nav" aria-label="Discover">
      {ITEMS.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>
      ))}
      <AppLink href="/" className="dx-back">Song Nexus</AppLink>
    </nav>
  );
}

export default function DiscoverNav() {
  return <NavLinks pathname={usePathname()} />;
}
