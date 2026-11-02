import { keys, redis } from "@/lib/redis";
import { authorize, json, removeItem, type Message } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string; msgId: string }> };

/** Authors delete their own messages; the room's creator can delete any. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, msgId } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  const messages = await redis().lrange<Message>(keys(id).messages, 0, -1);
  const msg = messages.find((m) => m.id === msgId);
  if (!msg) return json({ error: "Mensagem não encontrada" }, 404);
  if (msg.cid !== room.session.cid && room.owner !== room.session.cid) {
    return json({ error: "Você só pode apagar as suas mensagens" }, 403);
  }

  await removeItem(id, "messages", msg);
  return json({ ok: true });
}
