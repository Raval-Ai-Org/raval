// graph.server.ts — the only file that talks to graph.facebook.com.
//
// Tokens travel in the Authorization header, never a URL or a log, and every
// call carries appsecret_proof so a leaked token is useless without the app
// secret. A POST (a reply) is never retried: an unclear outcome is reported
// as `unknown` and resolved by reading the comment's replies.
import "server-only";
import { createHmac } from "node:crypto";
import { metaConfig } from "./config.server";

export class GraphError extends Error {
  constructor(
    message: string,
    /** token: reconnect. permission: a scope is missing. limit: try later. unknown: a write may have happened. */
    readonly kind: "token" | "permission" | "limit" | "unknown" | "other",
    readonly status: number,
  ) {
    super(message);
  }
}

const GRAPH = "https://graph.facebook.com";
const TIMEOUT_MS = 20_000;

function proof(token: string): string {
  return createHmac("sha256", metaConfig().appSecret).update(token).digest("hex");
}

type GraphErrorBody = { error?: { message?: string; code?: number; error_subcode?: number } };

function classify(status: number, body: GraphErrorBody): GraphError {
  const code = body.error?.code ?? 0;
  const message = (body.error?.message ?? `Meta answered ${status}.`).slice(0, 300);
  if (code === 190 || code === 102 || status === 401)
    return new GraphError("Meta signed this account out. Connect it again.", "token", status);
  if (code === 10 || (code >= 200 && code < 300) || status === 403)
    return new GraphError(
      "Meta didn't allow this. Connect again and allow every permission.",
      "permission",
      status,
    );
  if ([4, 17, 32, 613, 80001, 80002].includes(code) || status === 429)
    return new GraphError(
      "Meta asked Mellox to slow down. Try again in a few minutes.",
      "limit",
      status,
    );
  return new GraphError(message, "other", status);
}

function url(path: string, params: Record<string, string>, token?: string): string {
  const { version } = metaConfig();
  const u = new URL(`${GRAPH}/${version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (token) u.searchParams.set("appsecret_proof", proof(token));
  return u.toString();
}

/** A read. Retried once on a network failure or a 5xx; reads are safe to repeat. */
export async function graphGet<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url(path, params, token), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as T & GraphErrorBody;
      if (res.ok && !body.error) return body;
      if (res.status >= 500 && attempt === 0) continue;
      throw classify(res.status, body);
    } catch (error) {
      if (error instanceof GraphError) throw error;
      last = error;
    }
  }
  throw new GraphError(
    last instanceof Error && last.name === "TimeoutError"
      ? "Meta didn't answer in time."
      : "Couldn't reach Meta.",
    "other",
    0,
  );
}

/** A write. Never retried. */
export async function graphPost<T>(
  path: string,
  token: string,
  form: Record<string, string>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url(path, {}, token), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new GraphError("Meta didn't confirm the reply.", "unknown", 0);
  }
  const body = (await res.json().catch(() => null)) as (T & GraphErrorBody) | null;
  if (!body) {
    if (res.ok || res.status >= 500)
      throw new GraphError("Meta didn't confirm the reply.", "unknown", res.status);
    throw classify(res.status, {});
  }
  if (res.ok && !body.error) return body;
  if (res.status >= 500)
    throw new GraphError("Meta didn't confirm the reply.", "unknown", res.status);
  throw classify(res.status, body);
}

/** Code → user token, then the long-lived one (about 60 days). */
export async function exchangeMetaCode(
  code: string,
): Promise<{ token: string; expiresAt: string | null }> {
  const config = metaConfig();
  const read = async (params: Record<string, string>) => {
    const res = await fetch(url("oauth/access_token", params), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    } & GraphErrorBody;
    if (!res.ok || !body.access_token) throw classify(res.status, body);
    return body;
  };
  const short = await read({
    client_id: config.appId,
    client_secret: config.appSecret,
    redirect_uri: config.redirectUri,
    code,
  });
  const long = await read({
    grant_type: "fb_exchange_token",
    client_id: config.appId,
    client_secret: config.appSecret,
    fb_exchange_token: short.access_token!,
  }).catch(() => short);
  return {
    token: long.access_token!,
    expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000).toISOString() : null,
  };
}

/** Graph lists come in pages of `data`; Phase 1 reads the first page only. */
export type GraphList<T> = { data?: T[] };
