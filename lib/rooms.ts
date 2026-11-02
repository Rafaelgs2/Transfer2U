import { randomBytes, randomInt } from "node:crypto";
import { del, list } from "@vercel/blob";
import { NextResponse } from "next/server";
import { getSession, type Session } from "./auth";
import { codeKey, keys, redis } from "./redis";

export const DURATIONS_HOURS = [1, 24, 168] as const;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES_PER_ROOM = 50;
export const MAX_MESSAGES_PER_ROOM = 500;
export const MAX_USERS_PER_ROOM = 30;

export type Room = { id: string; password_hash: string | null; expires_at: string; owner: string; code: string | null };
export type AuthedRoom = Room & { session: Session };
type RoomRecord = { pw: string | null; exp: number; owner: string; code?: string };

export type Message = { id: string; text: string; at: number; by: string; cid: string };
export type StoredFile = {
  id: string;
  name: string;
  size: number;
  pathname: string;
  at: number;
  by: string;
  cid: string;
  type: string;
};

export const newRoomId = () => randomBytes(9).toString("base64url"); // 12 url-safe chars
export const newItemId = () => randomBytes(6).toString("hex");
export const newClientId = () => randomBytes(8).toString("hex");
export const blobPrefix = (roomId: string) => `t2u/${roomId}/`;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

// No 0/O or 1/I/L, so a code survives being read aloud or typed from another screen.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/** Uppercases and drops separators; returns null when it can't be a valid code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH || [...code].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return code;
}

/** Picks a free code and points it at the room. NX makes a collision retry instead of hijacking a room. */
async function reserveCode(roomId: string, exp: number): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    if (await redis().set(codeKey(code), roomId, { nx: true, exat: exp })) return code;
  }
  throw new Error("Could not reserve a room code");
}

export const NAME_HINT ="Use de 2 a 20 letras, números, espaço, ponto, _ ou -";

/** Normalizes a display name; returns null when it is not acceptable. */
export function validateName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 20) return null;
  return /^[\p{L}\p{N} ._-]+$/u.test(name) ? name : null;
}

/** Only these are ever served inline; SVG is excluded on purpose (it can carry scripts). */
const INLINE_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
export const isInlineImage = (type: string) => INLINE_IMAGES.has(type);
/** Thumbnails load the whole file, so only small images get one (saves free-tier bandwidth). */
export const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

const EXT_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
};
/** Blob may report octet-stream for files sent without a type; fall back to the extension. */
export function resolveType(name: string, reported: string): string {
  if (reported && reported !== "application/octet-stream") return reported.split(";")[0].trim().toLowerCase();
  return EXT_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
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

/** Reserves `name` (case-insensitive) for `cid`. Re-claiming with the same cid is fine. */
export async function claimName(roomId: string, expiresAt: Date, name: string, cid: string): Promise<boolean> {
  const k = keys(roomId).users;
  const field = name.toLowerCase();
  const holder = await redis().hget<string>(k, field);
  if (holder) return holder === cid;
  if ((await redis().hlen(k)) >= MAX_USERS_PER_ROOM) return false;
  const created = await redis().hsetnx(k, field, cid);
  if (!created) return (await redis().hget<string>(k, field)) === cid;
  await redis().expireat(k, Math.floor(expiresAt.getTime() / 1000));
  return true;
}

/** Creates the room, its version counter and the creator's name. Every key expires with the room. */
export async function createRoom(id: string, passwordHash: string | null, expiresAt: Date, creator: Session) {
  const k = keys(id);
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const code = await reserveCode(id, exp);
  const p = redis().pipeline();
  p.set(k.room, { pw: passwordHash, exp: expiresAt.getTime(), owner: creator.cid, code } satisfies RoomRecord);
  p.expireat(k.room, exp);
  p.set(k.version, 1);
  p.expireat(k.version, exp);
  p.hset(k.users, { [creator.name.toLowerCase()]: creator.cid });
  p.expireat(k.users, exp);
  await p.exec();
}

/** Looks up a room; treats expired rooms as missing. */
export async function getRoom(id: string): Promise<Room | null> {
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return null;
  const rec = await redis().get<RoomRecord>(keys(id).room);
  if (!rec || rec.exp <= Date.now()) return null;
  return {
    id,
    password_hash: rec.pw,
    expires_at: new Date(rec.exp).toISOString(),
    owner: rec.owner,
    code: rec.code ?? null,
  };
}

/** Resolves the room and the caller's session. Returns a response on failure. */
export async function authorize(id: string): Promise<AuthedRoom | NextResponse> {
  const room = await getRoom(id);
  if (!room) return json({ error: "Sala não encontrada ou expirada" }, 404);
  const session = await getSession(id);
  if (!session) return json({ error: "Sem acesso", needsJoin: true }, 401);
  return { ...room, session };
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

/** Removes one entry from a room list and bumps the version. */
export async function removeItem(roomId: string, list: "messages" | "files", item: Message | StoredFile) {
  const k = keys(roomId);
  const p = redis().pipeline();
  p.lrem(k[list], 1, item);
  p.incr(k.version);
  await p.exec();
}

/** Deletes a room's stored files (including orphaned uploads), then its Redis keys. */
export async function destroyRoom(id: string, code: string | null) {
  await deleteBlobs(blobPrefix(id));
  const k = keys(id);
  await redis().del(k.room, k.version, k.messages, k.files, k.users, ...(code ? [codeKey(code)] : []));
}

export async function deleteBlobs(prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    if (page.blobs.length) await del(page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
