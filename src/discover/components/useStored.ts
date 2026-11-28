import { useSyncExternalStore } from "react";
import { readStored, subscribeStored } from "../lib/stored";

/** A value this browser keeps, as stored; null on the server and while there is none. */
export function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribeStored,
    () => readStored(key),
    () => null,
  );
}
