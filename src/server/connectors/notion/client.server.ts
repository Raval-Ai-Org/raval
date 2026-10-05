import "server-only";
import { z } from "zod";
import { HttpError } from "@/server/http-error";
import { notionConfig, NOTION_VERSION } from "./config.server";

const BASE = "https://api.notion.com/v1";
export type NotionObject = Record<string, any>;
let nextRequestAt = 0;
async function waitForSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt);
  nextRequestAt = slot + 360;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

export async function notionRequest(
  token: string,
  path: string,
  init: RequestInit = {},
  retry = 0,
): Promise<NotionObject> {
  let response: Response;
  try {
    await waitForSlot();
    response = await fetch(`${BASE}${path}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new HttpError(504, "Notion did not respond. Try again.");
  }
  if (
    (response.status === 429 || response.status >= 500) &&
    retry < 2 &&
    (init.method === undefined ||
      init.method === "GET" ||
      (init.method === "PATCH" && !path.endsWith("/children")))
  ) {
    const seconds = Number(response.headers.get("retry-after"));
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Number.isFinite(seconds) && seconds > 0
          ? Math.min(seconds * 1000, 5000)
          : 500 * (retry + 1),
      ),
    );
    return notionRequest(token, path, init, retry + 1);
  }
  if (response.status === 401)
    throw new HttpError(409, "Your Notion connection needs to be reconnected.");
  if (response.status === 403)
    throw new HttpError(403, "Notion has not shared this page or data source with Mellox.");
  if (response.status === 404)
    throw new HttpError(404, "This Notion page or data source is unavailable.");
  if (response.status === 429) throw new HttpError(429, "Notion is busy. Try again shortly.");
  if (!response.ok) throw new HttpError(502, "Notion could not complete this action.");
  return response.json().catch(() => {
    throw new HttpError(502, "Notion returned an invalid response.");
  });
}

const Token = z.object({
  access_token: z.string().min(1),
  workspace_id: z.string().min(1),
  workspace_name: z.string().nullable().optional(),
  workspace_icon: z.string().nullable().optional(),
  bot_id: z.string().optional(),
});
export async function exchangeNotionCode(code: string) {
  const config = notionConfig();
  let response: Response;
  try {
    response = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    });
  } catch {
    throw new HttpError(504, "Notion authorization timed out.");
  }
  if (!response.ok) throw new HttpError(409, "Notion authorization failed. Try connecting again.");
  const parsed = Token.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new HttpError(502, "Notion returned an invalid authorization response.");
  return parsed.data;
}

export async function notionPages(token: string, dataSourceId: string, filter?: object) {
  const results: NotionObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await notionRequest(
      token,
      `/data_sources/${encodeURIComponent(dataSourceId)}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
          ...(filter ? { filter } : {}),
        }),
      },
    );
    results.push(...(Array.isArray(page.results) ? page.results : []));
    cursor = page.has_more && typeof page.next_cursor === "string" ? page.next_cursor : undefined;
    if (results.length > 5000)
      throw new HttpError(413, "Notion data source is too large to sync at once.");
  } while (cursor);
  return results;
}
