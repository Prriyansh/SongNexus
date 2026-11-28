// Google ID tokens for tests: a real RSA key pair, its public half served as Google serves its keys.
import { generateKeyPairSync, sign } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const KID = "test-key";
export const CLIENT_ID = "client-123.apps.googleusercontent.com";
export const keySet = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" }] };

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A token Google could have signed, with these claims over sensible defaults. */
export function googleToken(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const head = part({ alg: "RS256", kid: KID, typ: "JWT", ...header });
  const body = part({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    name: "Ada Lovelace",
    picture: "https://lh3.googleusercontent.com/a/photo",
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url")}`;
}

/** A fetch serving the key set, with this Cache-Control (none for the default). */
export const keyServer = (cacheControl?: string) =>
  async () => new Response(JSON.stringify(keySet), { headers: cacheControl ? { "cache-control": cacheControl } : {} });
