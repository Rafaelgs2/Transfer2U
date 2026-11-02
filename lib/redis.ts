import { Redis } from "@upstash/redis";

let client: Redis | null = null;

/** Server-only Upstash client. Accepts both the Upstash and the Vercel "KV_*" variable names. */
export function redis(): Redis {
  if (!client) {
    // `||`, not `??`: pulled env files can contain empty placeholders for the unused name.
    const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("Upstash Redis env vars are not set");
    client = new Redis({ url, token });
  }
  return client;
}

/** Short code -> room id. Expires with the room. */
export const codeKey = (code: string) => `t2u:c:${code}`;

/** Every key a room owns; they all expire together with the room. */
export const keys = (id: string) => ({
  room: `t2u:r:${id}`,
  version: `t2u:r:${id}:v`,
  messages: `t2u:r:${id}:m`,
  files: `t2u:r:${id}:f`,
  users: `t2u:r:${id}:u`, // hash: lowercased display name -> client id
});
