import { hasAccess } from "@/lib/auth";
import { keys, redis } from "@/lib/redis";
import { destroyRoom, getRoom, json, authorize, type Message, type StoredFile } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Room snapshot. Clients poll with `?v=<last version>`: when nothing changed the answer is a
 * single cheap Redis GET, which keeps polling inside the free Upstash quota.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(id)) return json({ error: "Sala não encontrada ou expirada" }, 404);
  if (!(await hasAccess(id))) {
    return (await getRoom(id))
      ? json({ error: "Sem acesso", needsJoin: true }, 401)
      : json({ error: "Sala não encontrada ou expirada" }, 404);
  }

  const k = keys(id);
  const known = new URL(req.url).searchParams.get("v");
  const version = await redis().get<number>(k.version);
  if (version === null) return json({ error: "Sala não encontrada ou expirada" }, 404);
  if (known !== null && Number(known) === version) return json({ unchanged: true, version });

  const p = redis().pipeline();
  p.get(k.room);
  p.lrange(k.messages, 0, -1);
  p.lrange(k.files, 0, -1);
  const [room, messages, files] = (await p.exec()) as [
    { pw: string | null; exp: number } | null,
    Message[],
    StoredFile[],
  ];
  if (!room || room.exp <= Date.now()) return json({ error: "Sala não encontrada ou expirada" }, 404);

  return json({
    version,
    expiresAt: new Date(room.exp).toISOString(),
    hasPassword: !!room.pw,
    messages,
    files: files.map(({ id, name, size, at }) => ({ id, name, size, at })),
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;
  await destroyRoom(id);
  return json({ ok: true });
}
