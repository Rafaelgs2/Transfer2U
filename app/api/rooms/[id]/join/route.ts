import { checkPassword, grantAccess, hasAccess } from "@/lib/auth";
import { allow, clientIp, getRoom, json } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

/** Opens the room: no-password rooms are granted straight away, others need the password. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return json({ error: "Sala não encontrada ou expirada" }, 404);

  const expiresAt = new Date(room.expires_at);
  const info = { expiresAt: room.expires_at, hasPassword: !!room.password_hash };

  if (await hasAccess(id)) return json(info);

  if (room.password_hash) {
    if (!(await allow(`join:${id}:${clientIp(req)}`, 10, 600))) {
      return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
    }
    const body = await req.json().catch(() => ({}));
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) return json({ needsPassword: true }, 401);
    if (!(await checkPassword(password, room.password_hash))) {
      return json({ needsPassword: true, error: "Senha incorreta" }, 401);
    }
  }

  await grantAccess(id, expiresAt);
  return json(info);
}
