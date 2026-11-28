"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { today, type TodayStory } from "../api";
import { storyHref } from "../lib/links";
import { Avatar } from "./parts";

type State = { story: TodayStory | null } | "loading" | "failed";

/** Today's story, the same for everyone until midnight UTC. */
export default function TodayCard() {
  const [state, setState] = useState<State>("loading");
  useEffect(() => {
    const controller = new AbortController();
    today(controller.signal)
      .then(({ story }) => setState({ story }))
      .catch(() => {
        if (!controller.signal.aborted) setState("failed");
      });
    return () => controller.abort();
  }, []);
  if (state === "loading") return <div className="dx-today dx-bone" aria-label="Loading today’s story" role="status" />;
  if (state === "failed" || !state.story)
    return (
      <Link className="dx-today" href="/discover/stories" prefetch={false}>
        <strong>Stories</strong>
        <span>Connections found in the credits, one at a time.</span>
      </Link>
    );
  const { story } = state;
  return (
    <Link className="dx-today" href={storyHref(story.n)} prefetch={false}>
      <span className="dx-today-faces">
        {story.artists.slice(0, 3).map((a) => (
          <Avatar key={a.id} id={a.id} name={a.name} photo={a.photo} size={52} />
        ))}
      </span>
      <span>
        <small>Today’s story · {story.title}</small>
        <strong>{story.text}</strong>
      </span>
    </Link>
  );
}
