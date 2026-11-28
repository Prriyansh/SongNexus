import { ChevronLeft, ChevronRight, Spline } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import ShareButton from "@/discover/components/ShareButton";
import StoryKeys from "@/discover/components/StoryKeys";
import { Avatar, Reasons, Skeleton } from "@/discover/components/parts";
import { sixDegreesHref, storyHref } from "@/discover/lib/links";
import { pageMetadata } from "@/discover/lib/metadata";
import { oneOf } from "@/discover/lib/query";
import { graph } from "@/discover/lib/server";
import { stories, storyNumber, type Story } from "@/discover/lib/stories";
import { entityHref } from "@/discover/lib/types";

export const metadata = pageMetadata(
  "Stories",
  "Surprising connections found in the credits, one at a time, each with the credits that prove it.",
  "/discover/stories",
);

export function StoryCard({ story, heading = "h2" }: { story: Story; heading?: "h2" | "h3" }) {
  const Heading = heading;
  return (
    <>
      <ul className="dx-story-faces" aria-label="Who it’s about">
        {story.artists.map((artist) => (
          <li key={artist.id}>
            <Link href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
              <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={88} eager />
              <span>{artist.name}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Heading className="dx-story-title">{story.title}</Heading>
      <p className="dx-story-text">{story.text}</p>
    </>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/discover/stories">, "searchParams">) {
  const all = stories(graph());
  if (!all.length)
    return (
      <p className="dx-panel dx-hint" role="status">
        This catalog has no stories yet.
      </p>
    );
  const n = storyNumber(oneOf(await searchParams, "story"), all.length);
  const story = all[n - 1];
  const previous = n > 1 ? storyHref(n - 1) : null;
  const next = n < all.length ? storyHref(n + 1) : null;
  return (
    <article className="dx-panel dx-story" aria-label={`Story ${n} of ${all.length}`}>
      <StoryKeys previous={previous} next={next} />
      <p className="dx-story-count">
        Story {n} of {all.length}
      </p>
      <StoryCard story={story} />
      <h3 className="dx-story-proof">The credits</h3>
      <Reasons reasons={story.reasons} total={story.reasons.length} />
      <div className="dx-story-actions">
        {story.pair && (
          <Link
            className="dx-button dx-quiet"
            href={sixDegreesHref({ from: story.pair[0], to: story.pair[1] })}
            prefetch={false}
          >
            <Spline size={16} aria-hidden="true" />
            <span>
              {story.pair[0].name} to {story.pair[1].name} in Six Degrees
            </span>
          </Link>
        )}
        <ShareButton label="Share this story" />
      </div>
      <nav className="dx-story-nav" aria-label="More stories">
        {previous ? (
          <Link className="dx-button" href={previous} scroll={false} prefetch={false}>
            <ChevronLeft size={18} aria-hidden="true" /> Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="dx-story-hint">Arrow keys or a swipe move between stories.</span>
        {next ? (
          <Link className="dx-button" href={next} scroll={false} prefetch={false}>
            Next <ChevronRight size={18} aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </article>
  );
}

export default function StoriesPage({ searchParams }: PageProps<"/discover/stories">) {
  return (
    <>
      <header className="dx-head">
        <h1>Stories</h1>
        <p>
          Connections found in the credits, one at a time. Each story shows the credits behind it,
          so you can check every word.
        </p>
      </header>
      <Suspense fallback={<Skeleton panels={1} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
