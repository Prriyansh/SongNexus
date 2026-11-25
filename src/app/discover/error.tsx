"use client";

import { useEffect } from "react";

/** Shown in place of a page that failed; the sidebar stays. */
export default function DiscoverError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="dx-panel dx-empty" role="alert">
      <h1>This page didn’t load</h1>
      <p>Something went wrong on our side. Trying again usually works.</p>
      <button type="button" className="dx-button" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
