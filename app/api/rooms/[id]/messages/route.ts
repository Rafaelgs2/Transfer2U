import {
  MAX_MESSAGES_PER_ROOM,
  allow,
  append,
  authorize,
  clientIp,
  json,
  newItemId,
} from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  if (!(await allow(`msg:${id}:${clientIp(req)}`, 120, 60))) {
    return json({ error: "Devagar! Muitas mensagens." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 4000) return json({ error: "Mensagem inválida" }, 400);

  try {
    await append(room, "messages", { id: newItemId(), text, at: Date.now() }, MAX_MESSAGES_PER_ROOM);
  } catch {
    return json({ error: "Não foi possível enviar" }, 500);
  }
  return json({ ok: true }, 201);
}
