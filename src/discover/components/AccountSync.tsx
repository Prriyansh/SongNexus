"use client";

import { useEffect } from "react";
import { account, saveSynced } from "../api";
import { mergeSynced, sameSynced, syncedFrom, writeSynced } from "../lib/account-data";
import { readStored, subscribeStored, writeStored } from "../lib/stored";

/** Told when someone signs in or out on this page, so syncing starts or stops. */
export const ACCOUNT_CHANGED = "song-nexus-account";
/** Changes are saved this long after the last one, so a burst of them is one save. */
export const SYNC_DELAY_MS = 1500;

/**
 * Keeps a signed-in person's games, hidden artists, Top 5 and services in step: on arrival the
 * account's are merged into this browser's, and later changes here are saved to the account.
 * Draws nothing.
 */
export default function AccountSync() {
  useEffect(() => {
    let signedIn = false;
    let saved = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller = new AbortController();

    const save = () => {
      const current = syncedFrom(readStored);
      const text = JSON.stringify(current);
      if (!signedIn || text === saved) return;
      saved = text;
      saveSynced(current).catch(() => {
        saved = ""; // try again with the next change
      });
    };
    const check = () => {
      controller.abort();
      controller = new AbortController();
      account(controller.signal)
        .then(({ person, synced }) => {
          signedIn = person !== null;
          if (!person) return;
          const local = syncedFrom(readStored);
          const merged = synced ? mergeSynced(local, synced) : local;
          saved = synced ? JSON.stringify(synced) : "";
          if (!sameSynced(merged, local)) writeSynced(merged, writeStored);
          save();
        })
        .catch(() => {});
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(save, SYNC_DELAY_MS);
    };

    check();
    const stop = subscribeStored(later);
    window.addEventListener(ACCOUNT_CHANGED, check);
    return () => {
      controller.abort();
      clearTimeout(timer);
      stop();
      window.removeEventListener(ACCOUNT_CHANGED, check);
    };
  }, []);
  return null;
}
