import "server-only";
import { z } from "zod";
import { HttpError } from "@/server/http-error";
import { canvaConfig, canvaMagicLayersEnabled } from "./config.server";

const BASE = "https://api.canva.com/rest/v1";
const Token = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export type CanvaTokens = z.infer<typeof Token>;

async function timedFetch(url: string, init: RequestInit) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(504, "Canva did not respond in time.");
  }
}

export async function tokenGrant(params: Record<string, string>): Promise<CanvaTokens> {
  const { clientId, clientSecret } = canvaConfig();
  const res = await timedFetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok)
    throw new HttpError(
      res.status === 400 ? 409 : 502,
      "Canva authorization failed. Reconnect Canva.",
    );
  const parsed = Token.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new HttpError(502, "Canva returned an invalid token response.");
  return parsed.data;
}

export async function revokeCanvaToken(token: string) {
  const { clientId, clientSecret } = canvaConfig();
  try {
    await timedFetch(`${BASE}/oauth/revoke`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token }),
    });
  } catch {
    /* Local deletion still makes this Mellox connection unusable. */
  }
}

export async function canvaRequest(token: string, path: string, init: RequestInit = {}) {
  const res = await timedFetch(`${BASE}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  if (res.status === 401) throw new HttpError(409, "Canva connection expired. Reconnect Canva.");
  if (res.status === 403)
    throw new HttpError(403, "Canva has not granted the required access. Reconnect Canva.");
  if (res.status === 429) {
    const seconds = Number(res.headers.get("retry-after"));
    throw new HttpError(
      429,
      Number.isFinite(seconds) && seconds > 0 && seconds < 3600
        ? `Canva is busy. Try again in ${Math.ceil(seconds)} seconds.`
        : "Canva is busy. Try again shortly.",
    );
  }
  if (!res.ok) throw new HttpError(502, "Canva could not complete this action.");
  return res.json().catch(() => {
    throw new HttpError(502, "Canva returned an invalid response.");
  });
}

export async function uploadImage(token: string, bytes: Buffer, name: string): Promise<string> {
  if (bytes.length > 50 * 1024 * 1024) throw new HttpError(413, "Image is too large for Canva.");
  const started = (await canvaRequest(token, "/asset-uploads", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "Asset-Upload-Metadata": JSON.stringify({
        name_base64: Buffer.from(name.slice(0, 50)).toString("base64"),
      }),
    },
    body: new Uint8Array(bytes),
  })) as { job?: { id?: string; status?: string; asset?: { id?: string } } };
  const id = started.job?.id;
  if (!id || !/^[\w-]+$/.test(id)) throw new HttpError(502, "Canva upload did not start.");
  for (let n = 0; n < 20; n++) {
    const result =
      n === 0 ? started : ((await canvaRequest(token, `/asset-uploads/${id}`)) as typeof started);
    if (result.job?.status === "success" && result.job.asset?.id) return result.job.asset.id;
    if (result.job?.status === "failed")
      throw new HttpError(502, "Canva could not upload this image.");
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 + n * 250, 3000)));
  }
  throw new HttpError(504, "Canva upload is still processing. Try again shortly.");
}

function safeEditUrl(value: string | undefined): string {
  if (!value) throw new HttpError(502, "Canva did not return a safe editor link.");
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && url.hostname === "www.canva.com") return url.toString();
  } catch {
    /* Invalid provider response. */
  }
  throw new HttpError(502, "Canva did not return a safe editor link.");
}

export async function createDesign(
  token: string,
  args: { assetId: string; title: string; width: number; height: number },
) {
  const response = (await canvaRequest(token, "/designs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "type_and_asset",
      design_type: { type: "custom", width: args.width, height: args.height },
      asset_id: args.assetId,
      title: args.title.slice(0, 255),
    }),
  })) as { design?: { id?: string; urls?: { edit_url?: string } } };
  const id = response.design?.id;
  if (!id) throw new HttpError(502, "Canva did not return a design identifier.");
  return { id, editUrl: safeEditUrl(response.design?.urls?.edit_url) };
}

export async function getDesignEditUrl(token: string, id: string) {
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, "Invalid Canva design.");
  const response = (await canvaRequest(token, `/designs/${id}`)) as {
    design?: { urls?: { edit_url?: string } };
  };
  return safeEditUrl(response.design?.urls?.edit_url);
}

type Job = {
  job?: {
    id?: string;
    status?: string;
    error?: { code?: string };
    result?: Record<string, unknown>;
    urls?: string[];
  };
};

async function pollJob(token: string, endpoint: string, started: Job, label: string) {
  const id = started.job?.id;
  if (!id || !/^[\w-]+$/.test(id)) throw new HttpError(502, `Canva ${label} did not start.`);
  for (let n = 0; n < 18; n++) {
    const response = n === 0 ? started : ((await canvaRequest(token, `${endpoint}/${id}`)) as Job);
    const job = response.job;
    if (job?.status === "success") return job;
    if (job?.status === "failed") throw new CanvaJobError(label, job.error?.code);
    if (n < 17) await new Promise((resolve) => setTimeout(resolve, Math.min(1000 + n * 400, 4000)));
  }
  throw new HttpError(504, `Canva ${label} is still processing. Try again shortly.`);
}

export class CanvaJobError extends HttpError {
  constructor(
    label: string,
    readonly code?: string,
  ) {
    super(502, `Canva could not complete ${label}.`);
  }
}

export async function hasMagicLayersCapability(token: string) {
  try {
    const result = (await canvaRequest(token, "/users/me/capabilities")) as {
      capabilities?: string[];
    };
    return (
      Array.isArray(result.capabilities) && result.capabilities.includes("image_to_design_imports")
    );
  } catch (error) {
    if (error instanceof HttpError && (error.status === 403 || error.status === 409)) return false;
    throw error;
  }
}

export async function imageToDesign(token: string, assetId: string, title: string) {
  const started = (await canvaRequest(token, "/image-to-design-imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image: { asset_id: assetId }, title: title.slice(0, 255) }),
  })) as Job;
  const job = await pollJob(token, "/image-to-design-imports", started, "image conversion");
  const design = job.result?.design as { id?: string; urls?: { edit_url?: string } } | undefined;
  if (!design?.id) throw new HttpError(502, "Canva did not return a converted design.");
  return { id: design.id, editUrl: safeEditUrl(design.urls?.edit_url) };
}

export async function importPptx(token: string, bytes: Buffer, title: string) {
  const started = (await canvaRequest(token, "/imports", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "Import-Metadata": JSON.stringify({
        title_base64: Buffer.from(title.slice(0, 50)).toString("base64"),
        mime_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    },
    body: new Uint8Array(bytes),
  })) as Job;
  const job = await pollJob(token, "/imports", started, "presentation import");
  const designs = job.result?.designs as
    Array<{ id?: string; page_count?: number; urls?: { edit_url?: string } }> | undefined;
  if (designs?.length !== 1 || !designs[0].id)
    throw new HttpError(502, "Canva did not return one presentation design.");
  const metadata = (await canvaRequest(token, `/designs/${designs[0].id}`)) as {
    design?: { page_count?: number };
  };
  if (!metadata.design?.page_count)
    throw new HttpError(502, "Canva did not confirm imported pages.");
  return {
    id: designs[0].id,
    pageCount: metadata.design.page_count,
    editUrl: safeEditUrl(designs[0].urls?.edit_url),
  };
}

export async function exportPngPages(token: string, designId: string) {
  if (!/^[\w-]+$/.test(designId)) throw new HttpError(400, "Invalid Canva design.");
  const started = (await canvaRequest(token, "/exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ design_id: designId, format: { type: "png", as_single_image: false } }),
  })) as Job;
  const job = await pollJob(token, "/exports", started, "export");
  if (
    !Array.isArray(job.urls) ||
    !job.urls.length ||
    job.urls.some((url) => typeof url !== "string")
  )
    throw new HttpError(502, "Canva did not return exported pages.");
  return job.urls;
}

/** Public Create Design always remains the usable flow when Preview is unavailable. */
export async function createSingleImageDesign(
  token: string,
  args: { assetId: string; title: string; width: number; height: number },
  magicEnabled = canvaMagicLayersEnabled(),
) {
  if (magicEnabled) {
    try {
      if (await hasMagicLayersCapability(token)) {
        const result = await imageToDesign(token, args.assetId, args.title);
        return { ...result, mode: "magic_layers" as const };
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) throw error;
      // Preview access, AI quota, rate limit, conversion and temporary provider errors.
    }
  }
  const result = await createDesign(token, args);
  return { ...result, mode: "flat_image" as const };
}
