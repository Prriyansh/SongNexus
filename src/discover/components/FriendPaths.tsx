"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { friendPaths, type FriendPaths as Paths } from "../api";
import { topIn, TOP_KEY } from "../lib/account-data";
import { FRIEND_SIDE, friendHref } from "../lib/links";
import { favouritesIn, PROFILE_KEY } from "../lib/stored";
import { entityHref, type ArtistRef } from "../lib/types";
import { AppLink, ArtistCard, Avatar, plural, Reasons, Section, Skeleton } from "./parts";
import { keyOf, myArtists, useListening } from "./useListening";
import { useStored } from "./useStored";


function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="dx-button" onClick={() => void copy()}>
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : copied === false ? "Couldn’t copy" : "Copy your link"}</span>
    </button>
  );
}

function Chain({ artists }: { artists: ArtistRef[] }) {
  return (
    <ol className="dx-chain" aria-label="Artists on this path">
      {artists.map((artist) => (
        <li key={artist.id}>
          <Link href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
            <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={64} />
            <span>{artist.name}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Compare({ mine, theirs, friend }: { mine: string[]; theirs: string[]; friend: string }) {
  const key = `${mine.join(",")}|${theirs.join(",")}`;
  const [result, setResult] = useState<{ key: string; paths: Paths | null } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    friendPaths(mine, theirs, controller.signal)
      .then((paths) => setResult({ key, paths }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, paths: null });
      });
    return () => controller.abort();
    // `key` stands for both sides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (result?.key !== key) return <Skeleton panels={2} />;
  if (!result.paths)
    return (
      <p className="dx-panel dx-hint" role="alert">
        The paths didn’t load. Try again in a moment.
      </p>
    );
  const { shared, paths, between } = result.paths;
  return (
    <>
      {shared.length > 0 && (
        <Section title="Artists you both have">
          <div className="dx-portraits">
            {shared.map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </div>
        </Section>
      )}
      <Section title={`From your artists to ${friend}’s`} note="The shortest paths in this catalog, every step a credit.">
        {paths.length ? (
          <ol className="dx-steps">
            {paths.map((path) => (
              <li key={path.artists.map((a) => a.id).join()}>
                <strong>{plural(path.artists.length - 1, "step")}</strong>
                <Chain artists={path.artists} />
                <Reasons reasons={path.reasons} total={path.reasons.length} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="dx-hint">No path between your artists and theirs in this catalog.</p>
        )}
      </Section>
      {between.length > 0 && (
        <Section title="People who link your artists and theirs">
          <div className="dx-portraits">
            {between.map((b) => (
              <div key={b.artist.id} className="dx-pick">
                <ArtistCard artist={b.artist} />
                <small>Worked with {b.with.map((a) => a.name).join(", ")}</small>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** Friend paths: share your artists as a link; opened with a friend's, how yours and theirs connect. */
export default function FriendPaths({ theirs, friend }: { theirs: ArtistRef[]; friend: string }) {
  const { connected, heard } = useListening();
  const favourites = favouritesIn(useStored(PROFILE_KEY)).artists;
  const top = topIn(useStored(TOP_KEY)).map((v) => v.id);
  const [name, setName] = useState("");
  const waiting = connected.some((c) => !heard[keyOf(c)]);
  const mine = myArtists(connected, heard, favourites, top).slice(0, FRIEND_SIDE);
  if (waiting) return <Skeleton panels={2} />;
  if (!mine.length)
    return (
      <p className="dx-panel dx-hint">
        First tell Song Nexus what you like: connect a service in{" "}
        <Link href="/discover/library" prefetch={false}>
          Library
        </Link>{" "}
        or add favourites in <AppLink href="/about">About Me</AppLink>.
      </p>
    );
  return (
    <>
      {theirs.length > 0 && <Compare mine={mine} theirs={theirs.map((a) => a.id)} friend={friend} />}
      <Section title="Send your artists to a friend" note="The link carries your top artists in the catalog and the name you give; nothing else.">
        <div className="dx-ask-row">
          <div className="dx-field">
            <input
              aria-label="Your name, if you want it on the link"
              placeholder="Your name (optional)"
              value={name}
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <CopyLink path={friendHref(mine, name)} />
        </div>
      </Section>
    </>
  );
}
