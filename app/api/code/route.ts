import { codeKey, redis } from "@/lib/redis";
import { allow, clientIp, json, normalizeCode } from "@/lib/rooms";

const NOT_FOUND = "Código não encontrado. Confira e tente de novo.";

/**
 * Turns a short code into a room id. It grants nothing by itself: the room page still asks for a
 * name and, if the room has one, the password. Codes live as long as the room, so this per-IP limit
 * is what stops someone from walking through the code space.
 */
export async function POST(req: Request) {
  if (!(await allow(`code:${clientIp(req)}`, 15, 600))) {
    return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(body.code);
  if (!code) return json({ error: NOT_FOUND }, 404);

  const id = await redis().get<string>(codeKey(code));
  if (!id) return json({ error: NOT_FOUND }, 404);
  return json({ id });
}
