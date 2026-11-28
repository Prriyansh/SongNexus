"use client";

import { Download, LogOut, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { account, deleteAccount, saveSynced, signIn, signOut, type Signed } from "../api";
import { MAX_TOP, mergeSynced, syncedFrom, topIn, TOP_KEY, writeSynced } from "../lib/account-data";
import { hiddenArtistsIn, HIDDEN_KEY, readStored, writeStored, type Visit } from "../lib/stored";
import type { EntityRef } from "../lib/types";
import { ACCOUNT_CHANGED } from "./AccountSync";
import EntitySearch from "./EntitySearch";
import { ArtistLink, Section } from "./parts";
import { useStored } from "./useStored";

type GoogleId = {
  initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void;
  renderButton: (element: HTMLElement, options: Record<string, string>) => void;
  disableAutoSelect?: () => void;
};
declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

export const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
/** Everything Song Nexus keeps in a browser starts with this. */
export const STORAGE_PREFIX = "song-nexus-";

const told = () => window.dispatchEvent(new Event(ACCOUNT_CHANGED));
const asRef = (visit: Visit) => ({ ...visit, listeners: null });

function Account({ clientId }: { clientId: string }) {
  const [person, setPerson] = useState<Signed | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const button = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    account(controller.signal)
      .then((found) => setPerson(found.person))
      .catch(() => {
        if (!controller.signal.aborted) {
          setPerson(null);
          setProblem("Your account didn’t load. Try again in a moment.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (person !== null) return;
    const signedIn = async (credential: string) => {
      try {
        const { person: found, synced } = await signIn(credential);
        const merged = mergeSynced(syncedFrom(readStored), synced);
        writeSynced(merged, writeStored);
        await saveSynced(merged);
        setProblem(null);
        setPerson(found);
        told();
      } catch (error) {
        setProblem((error as Error).message);
      }
    };
    const start = () => {
      const id = window.google!.accounts!.id!;
      id.initialize({ client_id: clientId, callback: ({ credential }) => void signedIn(credential) });
      id.renderButton(button.current!, { theme: "filled_black", size: "large", shape: "pill", text: "signin_with" });
    };
    if (window.google?.accounts?.id) return start();
    const script = document.createElement("script");
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.onload = start;
    script.onerror = () => setProblem("Google’s sign-in didn’t load. Check your connection and try again.");
    document.head.appendChild(script);
  }, [person, clientId]);

  const leave = async (remove: boolean) => {
    try {
      await (remove ? deleteAccount() : signOut());
      window.google?.accounts?.id?.disableAutoSelect?.();
      setDeleting(false);
      setPerson(null);
      told();
    } catch (error) {
      setProblem((error as Error).message);
    }
  };

  return (
    <Section title="Your account" note="Sign in to keep your games, Top 5, hidden artists and services the same in every browser.">
      {problem && (
        <p className="dx-hint" role="alert">
          {problem}
        </p>
      )}
      {person === undefined && <p className="dx-hint">Checking…</p>}
      {person === null && <div ref={button} className="dx-google" />}
      {person && (
        <div className="dx-you">
          {person.picture && (
            // A Google profile photo, shown as Google serves it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={person.picture} alt="" width={56} height={56} referrerPolicy="no-referrer" />
          )}
          <div>
            <strong>{person.name}</strong>
            <small>Signed in with Google{person.domain ? ` · ${person.domain}` : ""}</small>
          </div>
          <button type="button" className="dx-button dx-quiet" onClick={() => void leave(false)}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
          {deleting ? (
            <button type="button" className="dx-button dx-danger" onClick={() => void leave(true)}>
              Delete my account and everything synced
            </button>
          ) : (
            <button type="button" className="dx-button dx-quiet" onClick={() => setDeleting(true)}>
              <Trash2 size={16} aria-hidden="true" /> Delete account
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function Top() {
  const top = topIn(useStored(TOP_KEY));
  const add = (picked: EntityRef) => {
    const visit = { id: picked.id, name: picked.name, note: picked.note, photo: picked.image ?? null };
    writeStored(TOP_KEY, [...topIn(readStored(TOP_KEY)).filter((v) => v.id !== visit.id), visit].slice(0, MAX_TOP));
  };
  const remove = (id: string) => writeStored(TOP_KEY, topIn(readStored(TOP_KEY)).filter((v) => v.id !== id));
  return (
    <Section title="Your Top 5" note="The artists you’d name first. For you and Friend paths start from them.">
      {top.length > 0 && (
        <ol className="dx-top">
          {top.map((visit) => (
            <li key={visit.id}>
              <ArtistLink artist={asRef(visit)} />
              <button type="button" className="dx-icon-button" aria-label={`Take ${visit.name} out`} onClick={() => remove(visit.id)}>
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      )}
      {top.length < MAX_TOP ? (
        <EntitySearch label="Add an artist" placeholder="An artist you love" kinds={["artist"]} onPick={add} />
      ) : (
        <p className="dx-hint">That’s five. Take one out to add another.</p>
      )}
    </Section>
  );
}

function Hidden() {
  const hidden = hiddenArtistsIn(useStored(HIDDEN_KEY));
  const show = (id: string) => writeStored(HIDDEN_KEY, hiddenArtistsIn(readStored(HIDDEN_KEY)).filter((v) => v.id !== id));
  return (
    <Section title="Hidden artists" note="For you never suggests these.">
      {hidden.length ? (
        <ul className="dx-top">
          {hidden.map((visit) => (
            <li key={visit.id}>
              <ArtistLink artist={asRef(visit)} />
              <button type="button" className="dx-button dx-quiet" onClick={() => show(visit.id)}>
                Suggest again
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dx-hint">None. Hide an artist from For you with the ✕ on its suggestion.</p>
      )}
    </Section>
  );
}

function Data({ accounts }: { accounts: boolean }) {
  const [clearing, setClearing] = useState(false);
  const keys = () => Object.keys(window.localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));
  const download = () => {
    const data = Object.fromEntries(keys().map((key) => [key, JSON.parse(readStored(key)!)]));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    link.download = "song-nexus.json";
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const clear = async () => {
    // Signed out first, so clearing this browser can never empty the account too.
    if (accounts) {
      await signOut().catch(() => {});
      told();
    }
    keys().forEach((key) => writeStored(key, null));
    setClearing(false);
  };
  return (
    <Section title="Your data" note="Everything Song Nexus keeps in this browser: favourites, games, Library, Top 5.">
      <div className="dx-story-actions">
        <button type="button" className="dx-button dx-quiet" onClick={download}>
          <Download size={16} aria-hidden="true" /> Download it
        </button>
        {clearing ? (
          <button type="button" className="dx-button dx-danger" onClick={() => void clear()}>
            Yes, delete everything in this browser{accounts ? " and sign out here" : ""}
          </button>
        ) : (
          <button type="button" className="dx-button dx-quiet" onClick={() => setClearing(true)}>
            <Trash2 size={16} aria-hidden="true" /> Delete it from this browser
          </button>
        )}
      </div>
    </Section>
  );
}

/** You: your account, Top 5, hidden artists and data. Without sign-in set up, only this browser's. */
export default function You({ clientId }: { clientId: string | null }) {
  return (
    <>
      {clientId ? (
        <Account clientId={clientId} />
      ) : (
        <Section title="Your account">
          <p className="dx-hint">Sign-in isn’t set up on this server, so everything here is kept in this browser only.</p>
        </Section>
      )}
      <Top />
      <Hidden />
      <Data accounts={clientId !== null} />
    </>
  );
}
