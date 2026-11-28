import { ArrowRight, MessageCircleQuestion, Sparkles } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import {
  AppLink,
  ArtistCard,
  ArtistLink,
  Avatar,
  Chips,
  plural,
  Reasons,
  Section,
  Skeleton,
  SongLink,
} from "@/discover/components/parts";
import { aiEnabled, askWithAi } from "@/discover/lib/ai-ask";
import type { Answer, CreditPerson, CreditRole, Took } from "@/discover/lib/ask";
import { pageMetadata } from "@/discover/lib/metadata";
import { oneOf } from "@/discover/lib/query";
import { askHref, EXAMPLE_QUESTIONS } from "@/discover/lib/question";
import { normalize } from "@/discover/lib/search";
import { graph } from "@/discover/lib/server";
import { entityHref, type ArtistRef, type EntityRef } from "@/discover/lib/types";

export const metadata = pageMetadata(
  "Ask",
  "Ask how two artists are connected, who produced a song or who an artist worked with, and get the answer from the credits.",
  "/discover/ask",
);

/** Longer questions are cut here: no question Ask understands needs more. */
const MAX_QUESTION = 200;

function AskForm({ question }: { question: string }) {
  return (
    <form className="dx-search dx-ask" action="/discover/ask" role="search">
      <label htmlFor="ask-question">Ask about the credits</label>
      <div className="dx-ask-row">
        <div className="dx-field">
          <MessageCircleQuestion size={20} aria-hidden="true" />
          <input
            id="ask-question"
            name="q"
            type="text"
            defaultValue={question}
            placeholder="Who produced Umbrella?"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={MAX_QUESTION}
            required
          />
        </div>
        <button type="submit" className="dx-button">
          Ask <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function Examples({ title }: { title: string }) {
  return (
    <Section title={title}>
      <ul className="dx-chips" aria-label="Example questions">
        {EXAMPLE_QUESTIONS.map((question) => (
          <li key={question}>
            <Link href={askHref(question)} prefetch={false}>
              {question}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Which artist or song each name was taken to be, when that isn't plain from the name. */
function TookAs({ took }: { took: Took[] }) {
  const shown = took.filter((t) => normalize(t.said) !== normalize(t.ref.name));
  if (!shown.length) return null;
  return (
    <p className="dx-took">
      {shown.map((t) => (
        <span key={t.said}>
          “{t.said}” is read as{" "}
          <Link href={entityHref(t.ref)} prefetch={false}>
            {t.ref.name}
          </Link>
          {t.ref.note && ` (${t.ref.note})`}.{" "}
        </span>
      ))}
    </p>
  );
}

type ReplyProps = { reading: string; took?: Took[]; children: ReactNode };

function Reply({ reading, took = [], children }: ReplyProps) {
  return (
    <section className="dx-panel dx-reply" aria-label="Answer">
      <h2 className="dx-answer">{reading}</h2>
      <TookAs took={took} />
      {children}
    </section>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="dx-hint">{children}</p>;

function Faces({ artists }: { artists: ArtistRef[] }) {
  return (
    <ol className="dx-chain" aria-label="Artists on this path">
      {artists.map((artist) => (
        <li key={artist.id}>
          <Link href={entityHref({ kind: "artist", id: artist.id })} prefetch={false}>
            <Avatar id={artist.id} name={artist.name} photo={artist.photo} size={72} eager />
            <span>{artist.name}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function People({ people }: { people: CreditPerson[] }) {
  return (
    <div className="dx-grid">
      {people.map(({ artist, parts }) => (
        <ArtistLink key={artist.id} artist={artist}>
          {parts.join(", ") || artist.note}
        </ArtistLink>
      ))}
    </div>
  );
}

function Portraits({ artists }: { artists: ArtistRef[] }) {
  return artists.length ? (
    <div className="dx-portraits">
      {artists.map((artist) => (
        <ArtistCard key={artist.id} artist={artist} />
      ))}
    </div>
  ) : (
    <Hint>None in this catalog.</Hint>
  );
}

function More({ shown, total }: { shown: number; total: number }) {
  return total > shown ? <Hint>And {(total - shown).toLocaleString("en")} more.</Hint> : null;
}

const ROLE_WORDS: Record<CreditRole, string> = {
  producer: "producer",
  featured: "featured artist",
  performer: "performer",
  all: "",
};

function Refs({ items, label }: { items: EntityRef[]; label: string }) {
  return items.length ? <Chips items={items} label={label} /> : <Hint>None in this catalog.</Hint>;
}

const Onward = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="dx-button dx-quiet" href={href} prefetch={false}>
    {children} <ArrowRight size={16} aria-hidden="true" />
  </Link>
);

function AnswerView({ answer }: { answer: Answer }) {
  switch (answer.kind) {
    case "path": {
      const { result } = answer;
      return (
        <Reply reading={answer.reading} took={answer.took}>
          {result.status === "same-artist" && <Hint>That’s the same artist twice.</Hint>}
          {result.status === "not-connected" && (
            <Hint>No connection within six steps in this catalog.</Hint>
          )}
          {result.status === "ok" && (
            <>
              <p className="dx-lead">{plural(result.paths[0].steps.length, "step")} apart.</p>
              <Faces artists={result.paths[0].artists} />
              <ol className="dx-steps">
                {result.paths[0].steps.map((step) => (
                  <li key={step.to.id}>
                    <Reasons reasons={step.reasons.slice(0, 1)} total={step.reasonCount} />
                  </li>
                ))}
              </ol>
            </>
          )}
          <Onward href={answer.href}>Open in Six Degrees</Onward>
        </Reply>
      );
    }
    case "compare":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          <h3>Credited together</h3>
          {answer.linked.length ? (
            <Reasons reasons={answer.linked} total={answer.linkedTotal} />
          ) : (
            <Hint>No credit links them directly in this catalog.</Hint>
          )}
          <h3>People both worked with</h3>
          <Portraits artists={answer.shared} />
          <More shown={answer.shared.length} total={answer.sharedTotal} />
          <h3>Genres both are known for</h3>
          <Refs items={answer.genres} label="Shared genres" />
          <h3>Labels both released albums on</h3>
          <Refs items={answer.labels} label="Shared labels" />
          <div className="dx-story-actions">
            <Onward href={answer.pathHref}>The path between them</Onward>
            <AppLink className="dx-button dx-quiet" href={answer.exploreHref}>
              Compare them in Explore <ArrowRight size={16} aria-hidden="true" />
            </AppLink>
          </div>
        </Reply>
      );
    case "compare-songs":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          <div className="dx-grid">
            <SongLink song={answer.a} />
            <SongLink song={answer.b} />
          </div>
          <h3>Credited on both</h3>
          {answer.shared.length ? (
            <People people={answer.shared} />
          ) : (
            <Hint>No one is credited on both in this catalog.</Hint>
          )}
          <AppLink className="dx-button dx-quiet" href={answer.exploreHref}>
            Compare their sound and lyrics in Explore <ArrowRight size={16} aria-hidden="true" />
          </AppLink>
        </Reply>
      );
    case "credits":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          <SongLink song={answer.song} />
          {answer.groups.length ? (
            answer.groups.map((group) => (
              <div key={group.title}>
                <h3>{group.title}</h3>
                <People people={group.people} />
              </div>
            ))
          ) : (
            <Hint>This catalog has no {ROLE_WORDS[answer.role]} credit for this song.</Hint>
          )}
        </Reply>
      );
    case "collaborators":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          {answer.items.length ? (
            <div className="dx-grid">
              {answer.items.map(({ artist, count }) => (
                <ArtistLink key={artist.id} artist={artist}>
                  {plural(count, "credit")} together
                </ArtistLink>
              ))}
            </div>
          ) : (
            <Hint>None in this catalog.</Hint>
          )}
          <More shown={answer.items.length} total={answer.total} />
          <Onward href={answer.href}>Open {answer.artist.name}’s web</Onward>
        </Reply>
      );
    case "sampled":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          {answer.reasons.length ? (
            <Reasons reasons={answer.reasons} total={answer.total} />
          ) : (
            <Hint>No sample of {answer.artist.name} in this catalog.</Hint>
          )}
        </Reply>
      );
    case "connections":
      return (
        <Reply reading={answer.reading} took={answer.took}>
          <Portraits artists={answer.items} />
          <More shown={answer.items.length} total={answer.total} />
          <Hint>Connected by credits, the strongest first; not a measure of how alike they sound.</Hint>
          <Onward href={answer.href}>Open {answer.artist.name}’s web</Onward>
        </Reply>
      );
    case "lookup":
      return (
        <Reply reading={answer.reading}>
          <Refs items={answer.results} label="Results" />
        </Reply>
      );
    case "missing":
      return (
        <Reply reading={answer.reading}>
          {answer.names.map((name) => (
            <Hint key={name}>
              No {answer.what} called “{name}” in this catalog.
            </Hint>
          ))}
        </Reply>
      );
    default:
      return (
        <Reply reading="Not a question Ask can answer yet">
          <Hint>
            Ask answers from the credits: how two artists are connected, who is credited on a song,
            who an artist worked with, and what two artists or songs have in common.
          </Hint>
        </Reply>
      );
  }
}

async function Content({ searchParams }: Pick<PageProps<"/discover/ask">, "searchParams">) {
  const question = oneOf(await searchParams, "q").trim().slice(0, MAX_QUESTION);
  const asked = question ? await askWithAi(graph(), question) : null;
  const answer = asked?.answer ?? null;
  return (
    <>
      <AskForm key={question} question={question} />
      {asked?.ai && (
        <p className="dx-ai-note" role="note">
          <Sparkles size={16} aria-hidden="true" /> Read by AI as the question below. The answer itself comes
          from the credits; if it isn’t what you meant, try other words.
        </p>
      )}
      {answer && <AnswerView answer={answer} />}
      {(!answer || answer.kind === "unknown" || answer.kind === "missing") && (
        <Examples title={answer ? "Questions Ask can answer" : "Try asking"} />
      )}
    </>
  );
}

export default function AskPage({ searchParams }: PageProps<"/discover/ask">) {
  return (
    <>
      <header className="dx-head">
        <h1>Ask</h1>
        <p>
          Ask in plain words. The words choose the question; every answer comes from the credits in
          this catalog.{aiEnabled() && " Questions the patterns can’t read, or with a misspelled name, are read by AI."}
        </p>
      </header>
      <Suspense fallback={<Skeleton panels={2} />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </>
  );
}
