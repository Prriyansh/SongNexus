// Every music service Song Nexus knows about. To add one: write an adapter in ./providers that
// implements ProviderAdapter, add its id to PROVIDER_IDS in ./types.ts and its terms to
// ./policy.ts, and register it here. Nothing else needs to change: the routes, the sync engine and
// the dashboard all work from this list.

import { encryptionConfigured } from "../accounts/crypto";
import { POLICIES } from "./policy";
import { appleMusic } from "./providers/apple-music";
import { amazonMusic, deezer, shazam } from "./providers/blocked";
import { lastfm } from "./providers/lastfm";
import { listenbrainz } from "./providers/listenbrainz";
import { soundcloud } from "./providers/soundcloud";
import { spotify } from "./providers/spotify";
import { tidal } from "./providers/tidal";
import { youtube } from "./providers/youtube";
import { PROVIDER_IDS } from "./types";
import type { ProviderAdapter, ProviderDescriptor, ProviderId } from "./types";

type Env = Record<string, string | undefined>;

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  spotify, youtube, "apple-music": appleMusic, lastfm, listenbrainz, soundcloud, tidal, shazam, deezer, "amazon-music": amazonMusic,
};

export const adapter = (id: ProviderId): ProviderAdapter => ADAPTERS[id];
export const adapters = (): ProviderAdapter[] => PROVIDER_IDS.map((id) => ADAPTERS[id]);

/** The names of the variables still missing, never their values. */
export const missingEnv = (a: ProviderAdapter, env: Env = process.env) => a.requiredEnv.filter((name) => !env[name]?.trim());

/** Whether someone can connect this provider on this server right now. */
export const connectable = (a: ProviderAdapter, env: Env = process.env) => !a.blocked && !missingEnv(a, env).length && encryptionConfigured(env);

export function describe(a: ProviderAdapter, env: Env = process.env): ProviderDescriptor {
  const missing = missingEnv(a, env);
  const availability = a.blocked?.availability ?? (connectable(a, env) ? "available" : "not_configured");
  const note = a.blocked?.note
    ?? (availability === "available" ? a.setupNote
      // Operators see which variables to set; in production the names stay out of the public reply.
      : !encryptionConfigured(env) ? "This server has no encryption key for storing credentials, so accounts can’t be connected yet."
      : `This server hasn’t been given ${a.name} developer credentials yet${env.NODE_ENV === "production" ? "" : ` (${missing.join(", ")})`}. ${a.setupNote}`);
  return {
    id: a.id, name: a.name, auth: a.auth, availability, availabilityNote: note,
    capabilities: a.capabilities(null), policy: POLICIES[a.id], importFormats: a.importFormats,
    ...(a.tokenHelp ? { tokenHelp: a.tokenHelp } : {}),
    // No adapter has been exercised against its live service with real credentials from this repository.
    liveTested: false,
  };
}

export const describeAll = (env: Env = process.env): ProviderDescriptor[] => adapters().map((a) => describe(a, env));
