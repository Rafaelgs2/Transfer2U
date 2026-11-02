import { getSession } from "@/lib/auth";
import { keys, redis } from "@/lib/redis";
import {
  authorize,
  destroyRoom,
  getRoom,
  PREVIEW_MAX_BYTES,
  isInlineImage,
  json,
  type Message,
  type StoredFile,
} from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

const GONE = "Sala não encontrada ou expirada";

/**
 * Room snapshot. Clients poll with `?v=<last version>`: when nothing changed the answer is a
 * single cheap Redis GET, which keeps polling inside the free Upstash quota.
 * Items are returned with `mine`, never with other people's client ids.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return json({ error: GONE }, 404);

  const session = await getSession(id);
  if (!session) {
    return (await getRoom(id)) ? json({ error: "Sem acesso", needsJoin: true }, 401) : json({ error: GONE }, 404);
  }

  const k = keys(id);
  const known = new URL(req.url).searchParams.get("v");
  const version = await redis().get<number>(k.version);
  if (version === null) return json({ error: GONE }, 404);
  if (known !== null && Number(known) === version) return json({ unchanged: true, version });

  const p = redis().pipeline();
  p.get(k.room);
  p.lrange(k.messages, 0, -1);
  p.lrange(k.files, 0, -1);
  const [room, messages, files] = (await p.exec()) as [
    { pw: string | null; exp: number; owner: string } | null,
    Message[],
    StoredFile[],
  ];
  if (!room || room.exp <= Date.now()) return json({ error: GONE }, 404);

  return json({
    version,
    expiresAt: new Date(room.exp).toISOString(),
    hasPassword: !!room.pw,
    me: session.name,
    isOwner: room.owner === session.cid,
    messages: messages.map((m) => ({ id: m.id, text: m.text, at: m.at, by: m.by, mine: m.cid === session.cid })),
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      at: f.at,
      by: f.by,
      mine: f.cid === session.cid,
      image: isInlineImage(f.type) && f.size <= PREVIEW_MAX_BYTES,
    })),
  });
}

/** Only the room's creator can destroy it. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;
  if (room.owner !== room.session.cid) return json({ error: "Só quem criou a sala pode apagá-la" }, 403);
  await destroyRoom(id);
  return json({ ok: true });
}
