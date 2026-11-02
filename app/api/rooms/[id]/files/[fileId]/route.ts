import { del, get } from "@vercel/blob";
import { keys, redis } from "@/lib/redis";
import { authorize, isInlineImage, json, removeItem, type StoredFile } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

async function findFile(roomId: string, fileId: string) {
  const files = await redis().lrange<StoredFile>(keys(roomId).files, 0, -1);
  return files.find((f) => f.id === fileId);
}

/**
 * Streams a private blob to an authenticated room member. By default it is a download; with
 * `?inline=1` allow-listed image types are shown in the page (thumbnails), nothing else is.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id, fileId } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  const file = await findFile(id, fileId);
  if (!file) return json({ error: "Arquivo não encontrado" }, 404);

  const result = await get(file.pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return json({ error: "Arquivo não encontrado" }, 404);

  const inline = new URL(req.url).searchParams.get("inline") === "1" && isInlineImage(file.type);
  return new Response(result.stream, {
    headers: {
      "Content-Type": inline ? file.type : "application/octet-stream",
      "Content-Length": String(result.blob.size),
      "Content-Disposition": inline
        ? "inline"
        : `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": inline ? "private, max-age=300" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

/** Uploaders delete their own files; the room's creator can delete any. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, fileId } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  const file = await findFile(id, fileId);
  if (!file) return json({ error: "Arquivo não encontrado" }, 404);
  if (file.cid !== room.session.cid && room.owner !== room.session.cid) {
    return json({ error: "Você só pode apagar os seus arquivos" }, 403);
  }

  await removeItem(id, "files", file);
  await del(file.pathname).catch(() => {}); // the daily cleanup catches anything missed
  return json({ ok: true });
}
