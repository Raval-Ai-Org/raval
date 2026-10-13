import "server-only";
import { HttpError } from "@/server/http-error";

/** Bound the stream before multipart parsing, including chunked uploads. */
export async function readReferenceForm(
  request: Request,
  limit = 22 * 1024 * 1024,
): Promise<FormData> {
  if (Number(request.headers.get("content-length") ?? 0) > limit)
    throw new HttpError(413, "Choose a smaller reference file.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Choose an image or short video.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new HttpError(413, "Choose a smaller reference file.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Request(request.url, {
    method: "POST",
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    body: Buffer.concat(chunks),
  }).formData();
}
