import { randomBytes } from "node:crypto";
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { hasAccess } from "./auth";
import { keys, redis } from "./redis";

export const DURATIONS_HOURS = [1, 24, 168] as const;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_ROOM = 50;
export const MAX_MESSAGES_PER_ROOM = 500;

export type Room = { id: string; password_hash: string | null; expires_at: string };
type RoomRecord = { pw: string | null; exp: number };

export type Message = { id: string; text: string; at: number };
export type StoredFile = { id: string; name: string; size: number; pathname: string; at: number };

export const newRoomId = () => randomBytes(9).toString("base64url"); // 12 url-safe chars
export const newItemId = () => randomBytes(6).toString("hex");
export const blobPrefix = (roomId: string) => `t2u/${roomId}/`;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

/** Returns false when the caller has exceeded `max` hits in the window. */
export async function allow(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const k = `t2u:rl:${key}`;
    const hits = await redis().incr(k);
    if (hits === 1) await redis().expire(k, windowSeconds);
    return hits <= max;
  } catch {
    return true; // fail open: a limiter outage must not take the app down
  }
}

/** Creates the room and its version counter. Every key expires with the room. */
export async function createRoom(id: string, passwordHash: string | null, expiresAt: Date) {
  const k = keys(id);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const p = redis().pipeline();
  p.set(k.room, { pw: passwordHash, exp: expiresAt.getTime() } satisfies RoomRecord);
  p.expireat(k.room, exp);
  p.set(k.version, 1);
  p.expireat(k.version, exp);
  await p.exec();
}

/** Looks up a room; treats expired rooms as missing. */
export async function getRoom(id: string): Promise<Room | null> {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return null;
  const rec = await redis().get<RoomRecord>(keys(id).room);
  if (!rec || rec.exp <= Date.now()) return null;
  return { id, password_hash: rec.pw, expires_at: new Date(rec.exp).toISOString() };
}

/** Resolves the room and verifies the caller holds a valid token. Returns a response on failure. */
export async function authorize(id: string): Promise<Room | NextResponse> {
  const room = await getRoom(id);
  if (!room) return json({ error: "Sala não encontrada ou expirada" }, 404);
  if (!(await hasAccess(id))) return json({ error: "Sem acesso", needsJoin: true }, 401);
  return room;
}

/** Appends to a room list (capped) and bumps the version so polling clients refetch. */
export async function append(room: Room, list: "messages" | "files", item: Message | StoredFile, cap: number) {
  const k = keys(room.id);
  const exp = Math.floor(new Date(room.expires_at).getTime() / 1000);
  const p = redis().pipeline();
  p.rpush(k[list], item);
  p.ltrim(k[list], -cap, -1);
  p.expireat(k[list], exp);
  p.incr(k.version);
  await p.exec();
}

/** Deletes a room's stored files (including orphaned uploads), then its Redis keys. */
export async function destroyRoom(id: string) {
  await deleteBlobs(blobPrefix(id));
  const k = keys(id);
  await redis().del(k.room, k.version, k.messages, k.files);
}

export async function deleteBlobs(prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
