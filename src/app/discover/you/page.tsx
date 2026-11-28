import You from "@/discover/components/You";
import { authConfig } from "@/discover/lib/auth";
import { pageMetadata } from "@/discover/lib/metadata";

export const metadata = pageMetadata(
  "You",
  "Your account, your Top 5, the artists you’ve hidden, and everything Song Nexus keeps for you.",
  "/discover/you",
);

export default function YouPage() {
  return (
    <>
      <header className="dx-head">
        <h1>You</h1>
        <p>Your account, your Top 5, the artists you’ve hidden, and the data Song Nexus keeps for you.</p>
      </header>
      <You clientId={authConfig()?.clientId ?? null} />
    </>
  );
}
