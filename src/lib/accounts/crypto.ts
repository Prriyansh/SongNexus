// Secrets at rest. Provider credentials are sealed with AES-256-GCM before they reach the database,
// bound to the row they belong to (so a sealed value copied to another row won't open), and session
// and OAuth state tokens are only ever stored as SHA-256 hashes.

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

type Env = Record<string, string | undefined>;

const VERSION = "v1";
const DEV_KEY_FILE = ".data/dev-encryption.key";

const b64 = (bytes: Buffer) => bytes.toString("base64url");
const parseKey = (value: string | undefined): Buffer | null => {
  if (!value?.trim()) return null;
  const key = Buffer.from(value.trim(), "base64");
  return key.length === 32 ? key : null;
};

export class EncryptionUnavailableError extends Error {
  constructor() {
    super("Connecting accounts isn’t set up on this server.");
    this.name = "EncryptionUnavailableError";
  }
}

const shared = globalThis as { __songNexusDevKey?: Buffer };

/** A key that survives restarts in development, kept in the ignored .data folder. Never used in production. */
function devKey(env: Env): Buffer {
  if (shared.__songNexusDevKey) return shared.__songNexusDevKey;
  let key: Buffer | null = null;
  if (env.NODE_ENV !== "test") {
    try {
      if (existsSync(DEV_KEY_FILE)) key = parseKey(readFileSync(DEV_KEY_FILE, "utf8"));
      if (!key) {
        key = randomBytes(32);
        mkdirSync(dirname(DEV_KEY_FILE), { recursive: true });
        writeFileSync(DEV_KEY_FILE, key.toString("base64"), { mode: 0o600 });
      }
    } catch { key = null; }
  }
  return (shared.__songNexusDevKey = key ?? randomBytes(32));
}

/**
 * Keys that may open a sealed value, newest first. INTEGRATIONS_ENCRYPTION_KEY is 32 random bytes,
 * base64. To rotate: move the old key to INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS and set a new one;
 * values are re-sealed with the new key the next time their tokens refresh.
 */
export function encryptionKeys(env: Env = process.env): Buffer[] {
  const current = parseKey(env.INTEGRATIONS_ENCRYPTION_KEY);
  const previous = parseKey(env.INTEGRATIONS_ENCRYPTION_KEY_PREVIOUS);
  if (current) return previous ? [current, previous] : [current];
  if (env.NODE_ENV === "production") return [];
  return [devKey(env)];
}

export const encryptionConfigured = (env: Env = process.env) => encryptionKeys(env).length > 0;

/** Encrypts `plaintext`. `context` (e.g. "connection:<user>:<provider>") must be given again to open it. */
export function seal(plaintext: string, context: string, env: Env = process.env): string {
  const [key] = encryptionKeys(env);
  if (!key) throw new EncryptionUnavailableError();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(body)].join(".");
}

export function open(sealed: string, context: string, env: Env = process.env): string {
  const [version, iv, tag, body] = sealed.split(".");
  const keys = encryptionKeys(env);
  if (!keys.length) throw new EncryptionUnavailableError();
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Stored credentials are in an unknown format.");
  for (const key of keys) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
    } catch { /* Try the previous key. */ }
  }
  throw new Error("Stored credentials could not be opened with this server’s key.");
}

export const randomToken = (bytes = 32) => b64(randomBytes(bytes));
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const SECRET_PARAM = /\b(access_token|refresh_token|id_token|client_secret|code_verifier|code|token|sk|api_sig|api_key|key|music[-_]user[-_]token|password)=([^&\s"']+)/gi;
const SECRET_JSON = /"(access_token|refresh_token|id_token|client_secret|token|key|sk|password|musicUserToken)"\s*:\s*"[^"]*"/gi;
const BEARER = /\b(Bearer|OAuth|Token)\s+[A-Za-z0-9._~+/=-]{8,}/g;

/** Strips anything that looks like a credential, for log lines and stored error messages. */
export const redact = (text: string) =>
  text.replace(SECRET_PARAM, "$1=[redacted]").replace(SECRET_JSON, '"$1":"[redacted]"').replace(BEARER, "$1 [redacted]");
