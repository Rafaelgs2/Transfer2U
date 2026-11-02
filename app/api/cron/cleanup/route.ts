import { del, list } from "@vercel/blob";
import { keys, redis } from "@/lib/redis";
import { json } from "@/lib/rooms";

const MAX_PAGES = 5; // 5 x 1000 blobs per run keeps the function well inside its time limit

/**
 * Redis drops expired rooms by itself, but their blobs stay behind. This deletes every blob whose
 * room no longer exists (expired, deleted, or an upload that was never registered).
 * Triggered by Vercel Cron (see vercel.json), which sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  let cursor: string | undefined;
  let removed = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await list({ prefix: "t2u/", cursor, limit: 1000 });

    const roomOf = (pathname: string) => pathname.split("/")[1];
    const roomIds = [...new Set(res.blobs.map((b) => roomOf(b.pathname)))];
    if (roomIds.length) {
      const p = redis().pipeline();
      roomIds.forEach((id) => p.exists(keys(id).room));
      const alive = (await p.exec()) as number[];
      const dead = new Set(roomIds.filter((_, i) => !alive[i]));
      const orphans = res.blobs.filter((b) => dead.has(roomOf(b.pathname))).map((b) => b.pathname);
      if (orphans.length) await del(orphans);
      removed += orphans.length;
    }

    if (!res.hasMore) break;
    cursor = res.cursor;
  }

  return json({ removedBlobs: removed });
}
