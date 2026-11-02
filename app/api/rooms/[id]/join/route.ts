import { checkPassword, getSession, grantAccess } from "@/lib/auth";
import { NAME_HINT, allow, claimName, clientIp, getRoom, json, newClientId, validateName } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Opens the room. A newcomer must give a display name (unique in the room) and, if the room has
 * one, the password. Whoever already holds a valid cookie just gets the room info back.
 * A 401 with `needsJoin` tells the page to show the join form.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const room = await getRoom(id);
  if (!room) return json({ error: "Sala não encontrada ou expirada" }, 404);

  const hasPassword = !!room.password_hash;
  const info = { expiresAt: room.expires_at, hasPassword };

  const existing = await getSession(id);
  if (existing) return json({ ...info, name: existing.name });

  const needsJoin = (error?: string, status = 401) => json({ ...info, needsJoin: true, error }, status);

  const body = await req.json().catch(() => ({}));
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  // The page's first call is an empty probe to learn whether a password is needed: not an error.
  if (!rawName) return needsJoin();

  if (!(await allow(`join:${id}:${clientIp(req)}`, 20, 600))) {
    return json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  }

  const name = validateName(rawName);
  if (!name) return needsJoin(`Nome inválido. ${NAME_HINT}`);

  if (room.password_hash) {
    if (!password) return needsJoin();
    if (!(await checkPassword(password, room.password_hash))) return needsJoin("Senha incorreta");
  }

  // Claim the name only after the password checked out, so wrong guesses can't squat names.
  const cid = newClientId();
  const expiresAt = new Date(room.expires_at);
  if (!(await claimName(id, expiresAt, name, cid))) {
    return needsJoin("Esse nome já está em uso ou a sala está cheia. Escolha outro.", 409);
  }

  await grantAccess(id, expiresAt, { cid, name });
  return json({ ...info, name });
}
