import { grantAccess, hashPassword } from "@/lib/auth";
import {
  DURATIONS_HOURS,
  NAME_HINT,
  allow,
  clientIp,
  createRoom,
  json,
  newClientId,
  newRoomId,
  validateName,
} from "@/lib/rooms";

export async function POST(req: Request) {
  // Locally every request shares one address, so normal testing would hit the real limit.
  const maxPerHour = process.env.NODE_ENV === "production" ? 20 : 1000;
  if (!(await allow(`create:${clientIp(req)}`, maxPerHour, 3600))) {
    return json({ error: "Muitas salas criadas. Tente mais tarde." }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const hours = Number(body.durationHours ?? 1);
  if (!DURATIONS_HOURS.includes(hours as (typeof DURATIONS_HOURS)[number])) {
    return json({ error: "Duração inválida" }, 400);
  }
  const name = validateName(body.name);
  if (!name) return json({ error: `Nome inválido. ${NAME_HINT}` }, 400);
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length > 100) return json({ error: "Senha muito longa" }, 400);

  const id = newRoomId();
  const expiresAt = new Date(Date.now() + hours * 3600_000);
  const session = { cid: newClientId(), name };
  try {
    await createRoom(id, password ? await hashPassword(password) : null, expiresAt, session);
  } catch {
    return json({ error: "Não foi possível criar a sala" }, 500);
  }

  await grantAccess(id, expiresAt, session); // creator skips the password prompt
  return json({ id, expiresAt: expiresAt.toISOString() }, 201);
}
