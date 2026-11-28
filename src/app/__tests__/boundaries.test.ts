// Server code may import components and types from "use client" modules, but nothing else: any other
// value arrives on the server as a client reference, not the value. (Friend paths once read a
// constant that way and found no artists.) Unit tests have no such boundary, so this checks the
// imports themselves.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const isClient = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

/** The file an import names, if it is one of ours. */
function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  const found = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map((ext) => base + ext).find((f) => existsSync(f) && statSync(f).isFile());
  return found ?? null;
}

/** Named imports from client modules that aren't components or types. */
export function strayImports(file: string, text: string): string[] {
  const stray: string[] = [];
  for (const [, typeOnly, clause, spec] of text.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g)) {
    const target = resolve(file, spec);
    if (typeOnly || !target || !isClient(target)) continue;
    const named = /\{([^}]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of named.split(",").map((p) => p.trim()).filter(Boolean)) {
      if (part.startsWith("type ")) continue;
      const name = part.split(/\s+as\s+/).pop()!;
      // Components are PascalCase; SHOUTING_CASE and camelCase names are values.
      if (!/^[A-Z](?=[A-Za-z0-9]*[a-z])[A-Za-z0-9]*$/.test(name)) stray.push(`${path.relative(SRC, file)}: ${name} from ${spec}`);
    }
  }
  return stray;
}

describe("the server/client boundary", () => {
  it("lets server code take only components and types from client modules", () => {
    const server = [...sources(path.join(SRC, "app")), ...sources(path.join(SRC, "discover"))].filter((f) => !isClient(f));
    expect(server.length).toBeGreaterThan(20);
    expect(server.flatMap((file) => strayImports(file, readFileSync(file, "utf8")))).toEqual([]);
  });

  it("would catch a constant read from a client module", () => {
    const page = path.join(SRC, "app/discover/friends/page.tsx");
    const text = 'import FriendPaths, { SIDE, type X, Shown as Other } from "@/discover/components/FriendPaths";\nimport { graph } from "@/discover/lib/server";\nimport { useState } from "react";\nimport type { Y } from "@/discover/components/FriendPaths";';
    expect(strayImports(page, text)).toEqual([`${path.join("app", "discover", "friends", "page.tsx")}: SIDE from @/discover/components/FriendPaths`]);
  });
});
