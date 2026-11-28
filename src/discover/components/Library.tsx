"use client";

import { ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import { nexus, type Nexus } from "../api";
import { connectedIn, isUser, MAX_CONNECTED, SERVICE_INFO, SERVICES, SERVICES_KEY, type Connected, type Service } from "../lib/services";
import { favouritesIn, PROFILE_KEY, readStored, writeStored } from "../lib/stored";
import { AppLink, ArtistCard, ArtistLink, plural, Reasons, Section, Skeleton } from "./parts";
import { keyOf, myArtists, useListening, type Heard } from "./useListening";
import { useStored } from "./useStored";

/** Your Nexus looks at this many of your artists. */
export const NEXUS_ARTISTS = 25;

function ConnectForm({ connected }: { connected: Connected[] }) {
  const [service, setService] = useState<Service>("listenbrainz");
  const [user, setUser] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const name = user.trim();
    if (!isUser(service, name)) return setProblem(`That isn’t a ${SERVICE_INFO[service].name} username.`);
    if (connected.length >= MAX_CONNECTED) return setProblem(`You can connect up to ${MAX_CONNECTED}.`);
    setProblem(null);
    setUser("");
    writeStored(SERVICES_KEY, [...connectedIn(readStored(SERVICES_KEY)), { service, user: name }]);
  };
  return (
    <form
      className="dx-search dx-ask"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <label htmlFor="library-user">Connect a service by its public username</label>
      <div className="dx-ask-row">
        <select
          className="dx-select"
          aria-label="Service"
          value={service}
          onChange={(event) => setService(event.target.value as Service)}
        >
          {SERVICES.map((s) => (
            <option key={s} value={s}>
              {SERVICE_INFO[s].name}
            </option>
          ))}
        </select>
        <div className="dx-field">
          <input
            id="library-user"
            value={user}
            placeholder={SERVICE_INFO[service].user}
            onChange={(event) => setUser(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <button type="submit" className="dx-button">
          Connect
        </button>
      </div>
      <p className="dx-hint">
        {problem ?? `${SERVICE_INFO[service].hint} Read from the service’s public profile; nothing is stored but the username, in this browser.`}
      </p>
    </form>
  );
}

function Listening({ connected, heard }: { connected: Connected; heard: Heard | undefined }) {
  const info = SERVICE_INFO[connected.service];
  const disconnect = () =>
    writeStored(SERVICES_KEY, connectedIn(readStored(SERVICES_KEY)).filter((c) => keyOf(c) !== keyOf(connected)));
  const artists = heard && "artists" in heard ? heard.artists : null;
  const found = artists?.filter((a) => a.artist).length ?? 0;
  return (
    <section className="dx-panel" aria-label={`${info.name}: ${connected.user}`}>
      <header className="dx-line">
        <div>
          <h2>
            {info.name} ·{" "}
            <a href={info.profile(connected.user)} target="_blank" rel="noreferrer">
              {connected.user} <ExternalLink size={14} aria-hidden="true" />
            </a>
          </h2>
          {artists && (
            <p>
              {plural(found, "artist")} of {artists.length} in this catalog.
            </p>
          )}
        </div>
        <button type="button" className="dx-button dx-quiet" onClick={disconnect}>
          <X size={16} aria-hidden="true" /> Disconnect
        </button>
      </header>
      {!heard && <Skeleton panels={1} />}
      {heard && "error" in heard && (
        <p className="dx-hint" role="alert">
          {heard.error}
        </p>
      )}
      {artists && !artists.length && <p className="dx-hint">No listening there yet.</p>}
      {artists && artists.length > 0 && (
        <ol className="dx-heard">
          {artists.map((a, i) => (
            <li key={`${a.name}-${i}`}>
              {a.artist ? (
                <ArtistLink artist={a.artist}>{a.plays === null ? a.artist.note : plural(a.plays, "play")}</ArtistLink>
              ) : (
                <span className="dx-heard-missing">
                  <strong>{a.name}</strong>
                  <small>{a.plays === null ? "Not in this catalog" : `${plural(a.plays, "play")} · not in this catalog`}</small>
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function YourNexus({ ids }: { ids: string[] }) {
  const key = ids.join(",");
  const [result, setResult] = useState<{ key: string; nexus: Nexus | null } | null>(null);
  useEffect(() => {
    if (ids.length < 2) return;
    const controller = new AbortController();
    nexus(ids, controller.signal)
      .then((found) => setResult({ key, nexus: found }))
      .catch(() => {
        if (!controller.signal.aborted) setResult({ key, nexus: null });
      });
    return () => controller.abort();
    // `key` stands for the artists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (ids.length < 2)
    return (
      <p className="dx-hint">
        Connect a service above, or add favourites in <AppLink href="/about">About Me</AppLink>, and this
        shows how your artists are connected.
      </p>
    );
  if (result?.key !== key) return <Skeleton panels={1} />;
  if (!result.nexus)
    return (
      <p className="dx-hint" role="alert">
        Your Nexus didn’t load. Try again in a moment.
      </p>
    );
  const { linked, between } = result.nexus;
  return (
    <>
      <h3>Your artists who worked together</h3>
      {linked.length ? (
        <Reasons reasons={linked.map((l) => l.reason)} total={linked.length} />
      ) : (
        <p className="dx-hint">None of them share a credit in this catalog.</p>
      )}
      <h3>The people between them</h3>
      {between.length ? (
        <div className="dx-portraits">
          {between.map((b) => (
            <div key={b.artist.id} className="dx-pick">
              <ArtistCard artist={b.artist} />
              <small>Worked with {b.with.map((a) => a.name).join(", ")}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="dx-hint">No one in this catalog worked with more than one of them.</p>
      )}
    </>
  );
}

/** Library: listening from the services connected here, and how your artists are connected. */
export default function Library() {
  const { connected, heard } = useListening();
  const favourites = favouritesIn(useStored(PROFILE_KEY)).artists;
  const waiting = connected.some((c) => !heard[keyOf(c)]);
  return (
    <>
      <ConnectForm connected={connected} />
      {connected.map((c) => (
        <Listening key={keyOf(c)} connected={c} heard={heard[keyOf(c)]} />
      ))}
      <Section title="Your Nexus" note="The artists you play most and your About Me favourites, in the credits.">
        {waiting ? <Skeleton panels={1} /> : <YourNexus ids={myArtists(connected, heard, favourites).slice(0, NEXUS_ARTISTS)} />}
      </Section>
      <Section title="Playlist maps">
        <p className="dx-hint">
          Map a playlist, or put yours beside a friend’s, in <AppLink href="/friends">Friends</AppLink>.
        </p>
      </Section>
    </>
  );
}
