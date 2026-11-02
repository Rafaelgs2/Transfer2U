import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = () => {
  const s = process.env.ROOM_TOKEN_SECRET;
  if (!s || s.length < 32) throw new Error("ROOM_TOKEN_SECRET must be set (>= 32 chars)");
  return new TextEncoder().encode(s);
};

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const cookieName = (roomId: string) => `t2u_${roomId}`;

/** Issues a token that is valid until the room expires, stored in an httpOnly cookie. */
export async function grantAccess(roomId: string, expiresAt: Date) {
  const token = await new SignJWT({ rid: roomId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  (await cookies()).set(cookieName(roomId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function hasAccess(roomId: string): Promise<boolean> {
  const token = (await cookies()).get(cookieName(roomId))?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.rid === roomId;
  } catch {
    return false;
  }
}
