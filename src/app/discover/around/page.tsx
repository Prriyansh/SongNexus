import { Suspense } from "react";
import AroundYou from "@/discover/components/AroundYou";
import { Skeleton } from "@/discover/components/parts";
import { pageMetadata } from "@/discover/lib/metadata";
import { oneOf } from "@/discover/lib/query";

export const metadata = pageMetadata(
  "Around You",
  "What a campus or a country is listening to, from people who choose to share their artists.",
  "/discover/around",
);

async function Content({ searchParams }: Pick<PageProps<"/discover/around">, "searchParams">) {
  const looking = oneOf(await searchParams, "c") || null;
  return <AroundYou key={looking} looking={looking} />;
}

export default function AroundPage({ searchParams }: PageProps<"/discover/around">) {
  return (
    <>
      <header className="dx-head">
        <h1>Around You</h1>
        <p>
          What a campus or a country is listening to, from signed-in people who choose to share their
          artists. Charts open once enough members share, and only show artists several of them named.
        </p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
