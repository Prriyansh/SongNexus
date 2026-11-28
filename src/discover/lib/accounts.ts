// Accounts as stored: the person Google named and their synced data, under their Google ID. Kept a
// year from the last change; deleting an account removes everything. Server only.
import { syncedIn, type Synced } from "./account-data";
import type { Person } from "./auth";
import type { Store } from "./store";

const TTL = 400 * 86_400;
/** Synced data bigger than this is refused: no one's games and artists need more. */
export const MAX_SYNCED = 200_000;

type Account = { person: Person; synced: Synced; created: number };

const keyOf = (sub: string) => `account:${sub}`;

export async function readAccount(store: Store, sub: string): Promise<Account | null> {
  const raw = await store.get(keyOf(sub));
  if (!raw) return null;
  const account = JSON.parse(raw) as Account;
  return { ...account, synced: syncedIn(account.synced) };
}

/** Saves who signed in, keeping their data; a first sign-in starts with nothing synced. */
export async function signedIn(store: Store, person: Person, now = Date.now()): Promise<Account> {
  const known = await readAccount(store, person.sub);
  const account = { person, synced: known?.synced ?? syncedIn({}), created: known?.created ?? now };
  await store.set(keyOf(person.sub), JSON.stringify(account), TTL);
  return account;
}

export async function saveSynced(store: Store, person: Person, synced: Synced): Promise<Synced> {
  const account = (await readAccount(store, person.sub)) ?? { person, created: Date.now() };
  await store.set(keyOf(person.sub), JSON.stringify({ ...account, person, synced }), TTL);
  return synced;
}

export const deleteAccount = (store: Store, sub: string) => store.del(keyOf(sub));
