import { issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { MAX_FILE_BYTES, allow, authorize, blobPrefix, clientIp, json } from "@/lib/rooms";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Presigned client uploads: the browser asks for a short-lived URL scoped to ONE pathname and a
 * size cap, then PUTs the file straight to Vercel Blob (which also sidesteps the ~4.5 MB
 * request-body limit of serverless functions). Auth to Blob is OIDC, no stored token.
 * Only URL requests need the room cookie; Blob's own completion callback is signed and has none.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as HandleUploadPresignedBody | null;
  if (!body) return json({ error: "Requisição inválida" }, 400);

  if (body.type === "blob.generate-presigned-url") {
    const room = await authorize(id);
    if (room instanceof Response) return room;
    if (!(await allow(`file:${id}:${clientIp(req)}`, 60, 600))) {
      return json({ error: "Muitos envios. Aguarde um pouco." }, 429);
    }
  }

  try {
    const result = await handleUploadPresigned({
      body,
      request: req,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith(blobPrefix(id)) || pathname.includes("..")) {
          throw new Error("Caminho de arquivo inválido");
        }
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil: Date.now() + 10 * 60_000,
        });
        return { token };
      },
    });
    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Falha no upload" }, 400);
  }
}
