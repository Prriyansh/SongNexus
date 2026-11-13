// Services that can't be connected from Song Nexus, and why. They're listed so the dashboard can
// say so plainly and point at what does work (an import, or a scrobbler) rather than showing a
// button that leads nowhere. None of these has an authorize() or any resources.

import type { Availability, ProviderAdapter, ProviderId } from "../types";
import { capabilitySet } from "./shared";
import type { CapabilitySpec } from "./shared";

function blocked(id: ProviderId, name: string, availability: Exclude<Availability, "available" | "not_configured">, note: string, spec: CapabilitySpec, importFormats: string[] = []): ProviderAdapter {
  return {
    id, name, auth: "none", scopes: [], requiredEnv: [], setupNote: note, importFormats,
    blocked: { availability, note },
    capabilities: () => capabilitySet(name, spec, null),
    authHeaders: () => ({}),
    resources: [],
  };
}

/**
 * ShazamKit's synced SHLibrary exists on supported native Apple platforms. This repository has
 * no native client, so Song Nexus offers a user-controlled CSV import instead.
 */
export const shazam = blocked("shazam", "Shazam", "import_only",
  "Shazam has no ordinary web OAuth API for your library. ShazamKit's synced library requires a supported native Apple app; Song Nexus is web-only. Download your history from shazam.com/myshazam and import the CSV here.",
  {
    native_only: { note: "ShazamKit (SHLibrary) runs only in native Apple apps." },
    manual_import: { note: "The CSV from shazam.com/myshazam." },
    recent_history: "Only through the CSV import: Shazam has no web API for it.",
  }, ["shazam-library"]);

/**
 * Deezer paused its developer programme in 2025 and, as of November 2026, hasn't said publicly that
 * new applications can be registered again. Without an application there is no OAuth client to
 * sign users in with. If that changes, this becomes a normal OAuth adapter.
 */
export const deezer = blocked("deezer", "Deezer", "unsupported",
  "Deezer isn’t accepting new developer applications at the moment, so there is no way to sign in with Deezer here. You can still upload a playlist exported as CSV or JSON.",
  { manual_import: { note: "A playlist file (CSV or JSON) from any export tool." } }, ["generic"]);

/** Amazon Music's Web API is a closed beta: Amazon grants access to approved partners only. */
export const amazonMusic = blocked("amazon-music", "Amazon Music", "partner_access_required",
  "Amazon Music’s API is a closed beta for partners Amazon has approved. Song Nexus doesn’t have that access, so Amazon Music accounts can’t be connected.",
  { manual_import: { note: "A playlist file (CSV or JSON) from any export tool." } }, ["generic"]);
