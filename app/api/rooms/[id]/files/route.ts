import { del, head } from "@vercel/blob";
import { keys, redis } from "@/lib/redis";
import {
  MAX_FILES_PER_ROOM,
  MAX_FILE_BYTES,
  append,
  authorize,
  blobPrefix,
  json,
  newItemId,
  resolveType,
} from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Step 2 of an upload: the browser already put the file in Blob, now we register it in the room
 * so it shows up for everyone. Size and type come from Blob itself, never from the client.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  const body = await req.json().catch(() => ({}));
  const pathname = typeof body.pathname === "string" ? body.pathname : "";
  const name = typeof body.name === "string" ? body.name.slice(0, 200) : "";
  if (!name || !pathname.startsWith(blobPrefix(id)) || pathname.includes("..")) {
    return json({ error: "Arquivo inválido" }, 400);
  }

  const count = await redis().llen(keys(id).files);
  if (count >= MAX_FILES_PER_ROOM) {
    await del(pathname).catch(() => {});
    return json({ error: "Limite de arquivos da sala atingido" }, 409);
  }

  let size: number;
  let type: string;
  try {
    const meta = await head(pathname);
    size = meta.size;
    type = resolveType(name, meta.contentType);
  } catch {
    return json({ error: "Upload não encontrado" }, 400);
  }
  if (size > MAX_FILE_BYTES) {
    await del(pathname).catch(() => {});
    return json({ error: "Arquivo maior que 50 MB" }, 413);
  }

  await append(
    room,
    "files",
    { id: newItemId(), name, size, pathname, at: Date.now(), by: room.session.name, cid: room.session.cid, type },
    MAX_FILES_PER_ROOM,
  );
  return json({ ok: true }, 201);
}
