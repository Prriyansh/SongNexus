"use client";

import { useEffect } from "react";
import { readStored, RECENT_KEY, withVisit, writeStored, type Visit } from "../lib/stored";

/** Notes an artist page was opened, for "Where you left off". Draws nothing. */
export default function RememberVisit({ visit }: { visit: Visit }) {
  const { id, name, note, photo } = visit;
  useEffect(() => {
    writeStored(RECENT_KEY, withVisit(readStored(RECENT_KEY), { id, name, note, photo }));
  }, [id, name, note, photo]);
  return null;
}
