import { Suspense } from "react";
import FriendPaths from "@/discover/components/FriendPaths";
import { Avatar, Skeleton } from "@/discover/components/parts";
import { cleanName } from "@/discover/lib/leaderboard";
import { FRIEND_SIDE } from "@/discover/lib/links";
import { pageMetadata } from "@/discover/lib/metadata";
import { artistsIn, oneOf } from "@/discover/lib/query";
import { graph } from "@/discover/lib/server";
import { artistRef } from "@/discover/lib/words";

// About one person, so search engines leave it out.
export const metadata = {
  ...pageMetadata(
    "Friend paths",
    "How are your top artists connected to a friend’s? Share yours as a link and see the paths between them.",
    "/discover/friends",
  ),
  robots: { index: false, follow: true },
};

async function Content({ searchParams }: Pick<PageProps<"/discover/friends">, "searchParams">) {
  const query = await searchParams;
  const c = graph().catalog;
  const theirs = artistsIn(query, "with", c.artistAt, FRIEND_SIDE).map((at) => artistRef(c, at));
  const friend = cleanName(oneOf(query, "name")) ?? "your friend";
  return (
    <>
      {theirs.length > 0 && (
        <section className="dx-panel" aria-label={`${friend}’s artists`}>
          <h2>{`${friend[0].toUpperCase()}${friend.slice(1)}’s artists`}</h2>
          <ul className="dx-story-faces">
            {theirs.map((a) => (
              <li key={a.id}>
                <span className="dx-connect-face">
                  <Avatar id={a.id} name={a.name} photo={a.photo} size={64} />
                  <span>{a.name}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <FriendPaths theirs={theirs} friend={friend} />
    </>
  );
}

export default function FriendsPage({ searchParams }: PageProps<"/discover/friends">) {
  return (
    <>
      <header className="dx-head">
        <h1>Friend paths</h1>
        <p>How are your top artists connected to a friend’s? Send yours as a link; open theirs to see the paths.</p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
