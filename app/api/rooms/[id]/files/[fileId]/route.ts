import { get } from "@vercel/blob";
import { keys, redis } from "@/lib/redis";
import { authorize, json, type StoredFile } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string; fileId: string }> };

/** Streams a private blob to an authenticated room member as a download. */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, fileId } = await params;
  const room = await authorize(id);
  if (room instanceof Response) return room;

  const files = await redis().lrange<StoredFile>(keys(id).files, 0, -1);
  const file = files.find((f) => f.id === fileId);
  if (!file) return json({ error: "Arquivo não encontrado" }, 404);

  const result = await get(file.pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return json({ error: "Arquivo não encontrado" }, 404);

  return new Response(result.stream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(result.blob.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
