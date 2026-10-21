/** Read bytes with a hard limit, including chunked requests without Content-Length. */
async function readBodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyTooLargeError();
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Read JSON with a hard byte limit, including chunked requests without Content-Length. */
export async function readJsonBody(
  request: Request,
  maxBytes = 32 * 1024 * 1024,
): Promise<unknown> {
  const bytes = await readBodyBytes(request, maxBytes);
  if (bytes.byteLength === 0) return null;
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Preserve raw UTF-8 for signature verification, without buffering an unlimited body. */
export async function readWebhookBody(
  request: Request,
  maxBytes = 1_000_000,
): Promise<string | Response> {
  try {
    const bytes = await readBodyBytes(request, maxBytes);
    // A BOM, if supplied, is part of the signed payload too.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof RequestBodyTooLargeError ? "Payload too large" : "Invalid payload",
      },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestBodyTooLargeError";
  }
}
