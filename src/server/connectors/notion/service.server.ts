import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptWithKey, decryptWithKeys } from "@/server/crypto/secret-box.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import {
  createImportedContentItem,
  updateImportedContentItem,
  type ContentItem,
} from "@/server/fns/content";
import { notionConfig } from "./config.server";
import { exchangeNotionCode, notionPages, notionRequest, type NotionObject } from "./client.server";
import { consumeNotionState } from "./oauth.server";
import {
  decideSync,
  fromMellox,
  fromNotion,
  notionBodyBlocks,
  notionProperties,
  syncHash,
  type CalendarRecord,
} from "./mapping";

const db = supabaseAdmin as unknown as SupabaseClient;
type Conn = {
  id: string;
  workspace_id: string;
  status: string;
  account_login: string;
  external_account_id: string;
};
type Credential = {
  connection_id: string;
  workspace_id: string;
  access_token_enc: string;
  selected_database_id: string | null;
  selected_data_source_id: string | null;
  selected_destination_name: string | null;
  selected_destination_url: string | null;
  last_sync_at: string | null;
};
type Mapping = {
  id: string;
  content_item_id: string;
  notion_page_id: string;
  notion_data_source_id: string;
  last_mellox_hash: string | null;
  last_notion_hash: string | null;
};
const log = (
  workspaceId: string,
  operation: string,
  status: string,
  started: number,
  counts?: Record<string, number>,
) =>
  console.info(
    "[connector]",
    JSON.stringify({
      provider: "notion",
      workspaceId,
      operation,
      status,
      durationMs: Date.now() - started,
      ...counts,
    }),
  );
async function noteConnectionFailure(connectionId: string, workspaceId: string, error: unknown) {
  if (error instanceof HttpError && error.status === 409) {
    await db
      .from("workspace_connections")
      .update({ status: "error", last_error: "Reconnect Notion to continue." })
      .eq("id", connectionId)
      .eq("workspace_id", workspaceId);
    throw error;
  }
}

async function connection(workspaceId: string): Promise<Conn | null> {
  const { data, error } = await db
    .from("workspace_connections")
    .select("id,workspace_id,status,account_login,external_account_id")
    .eq("workspace_id", workspaceId)
    .eq("provider", "notion")
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, "Could not load Notion connection.");
  return data as Conn | null;
}
async function credential(workspaceId: string, connectionId: string): Promise<Credential> {
  const { data, error } = await db
    .from("notion_oauth_credentials")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (error)
    throw new HttpError(503, "Notion credentials are unavailable. Check the database migration.");
  if (!data) throw new HttpError(409, "Reconnect Notion to continue.");
  return data as Credential;
}
async function ready(workspaceId: string, destination = false) {
  const conn = await connection(workspaceId);
  if (!conn || conn.status !== "active") throw new HttpError(409, "Connect Notion to continue.");
  const cred = await credential(workspaceId, conn.id);
  if (destination && !cred.selected_data_source_id)
    throw new HttpError(409, "Choose a Notion content calendar first.");
  const { readKeys } = notionConfig();
  let token: string;
  try {
    token = decryptWithKeys(cred.access_token_enc, readKeys);
  } catch {
    throw new HttpError(409, "Notion credentials cannot be read. Reconnect Notion to continue.");
  }
  return { conn, cred, token };
}
/** A database lease makes create/reconcile operations exclusive across app instances. */
export async function withNotionSyncLock<T>(
  workspaceId: string,
  work: () => Promise<T>,
): Promise<T> {
  const conn = await connection(workspaceId);
  if (!conn) return work();
  const { data: stored, error: lookupError } = await db
    .from("notion_oauth_credentials")
    .select("connection_id")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", conn.id)
    .maybeSingle();
  if (lookupError) throw new HttpError(500, "Could not start Notion operation.");
  if (!stored) return work();
  const owner = randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("notion_oauth_credentials")
    .update({
      sync_lock_owner: owner,
      sync_lock_until: new Date(Date.now() + 45 * 60_000).toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("connection_id", conn.id)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`)
    .select("connection_id");
  if (error) throw new HttpError(500, "Could not start Notion operation.");
  if (!data?.length)
    throw new HttpError(409, "Another Notion operation is in progress. Try again shortly.");
  const renewal = setInterval(() => {
    void db
      .from("notion_oauth_credentials")
      .update({ sync_lock_until: new Date(Date.now() + 45 * 60_000).toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("connection_id", conn.id)
      .eq("sync_lock_owner", owner)
      .then(({ error: renewalError }) => {
        if (renewalError) log(workspaceId, "lock_renewal", "failed", Date.now());
      });
  }, 60_000);
  renewal.unref();
  try {
    return await work();
  } finally {
    clearInterval(renewal);
    const { error: releaseError } = await db
      .from("notion_oauth_credentials")
      .update({ sync_lock_owner: null, sync_lock_until: null })
      .eq("workspace_id", workspaceId)
      .eq("connection_id", conn.id)
      .eq("sync_lock_owner", owner);
    if (releaseError) log(workspaceId, "lock_release", "failed", Date.now());
  }
}
export async function notionStatus(workspaceId: string) {
  const conn = await connection(workspaceId);
  const cred =
    conn?.status === "active" ? await credential(workspaceId, conn.id).catch(() => null) : null;
  let configurationMessage: string | null = null;
  let readKeys: Buffer[] | null = null;
  try {
    readKeys = notionConfig().readKeys;
  } catch (error) {
    configurationMessage =
      error instanceof HttpError ? error.message : "Notion server configuration is unavailable.";
  }
  const configured = readKeys !== null;
  let status = conn?.status ?? "disconnected";
  if (status === "active" && !cred) status = "error";
  if (status === "active" && !configured) status = "error";
  if (status === "active" && cred && readKeys) {
    try {
      decryptWithKeys(cred.access_token_enc, readKeys);
    } catch {
      status = "error";
    }
  }
  return {
    configured,
    configurationMessage,
    status,
    workspaceName: conn?.account_login ?? null,
    destinationName: cred?.selected_destination_name ?? null,
    destinationUrl: cred?.selected_destination_url ?? null,
    dataSourceId: cred?.selected_data_source_id ?? null,
    lastSyncAt: cred?.last_sync_at ?? null,
  };
}
export async function completeNotionOAuth(args: { state: string; code: string }) {
  const txn = await consumeNotionState(args.state);
  const { data: member } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", txn.workspaceId)
    .eq("user_id", txn.userId)
    .maybeSingle();
  if (!member || !["owner", "admin", "editor"].includes(member.role))
    throw new HttpError(403, "Workspace access changed. Start again.");
  const started = Date.now();
  const token = await exchangeNotionCode(args.code);
  const old = await connection(txn.workspaceId);
  const values = {
    workspace_id: txn.workspaceId,
    provider: "notion",
    status: "active",
    external_account_id: token.workspace_id,
    account_login: token.workspace_name ?? "Notion workspace",
    account_avatar_url: token.workspace_icon ?? null,
    verification: "oauth",
    connected_by: txn.userId,
    revoked_at: null,
    last_error: null,
    updated_at: new Date().toISOString(),
  };
  let id = old?.id;
  if (id) {
    const { error } = await db
      .from("workspace_connections")
      .update(values)
      .eq("id", id)
      .eq("workspace_id", txn.workspaceId);
    if (error) throw new HttpError(500, "Could not save Notion connection.");
  } else {
    const { data, error } = await db
      .from("workspace_connections")
      .upsert(values, { onConflict: "workspace_id,provider,external_account_id" })
      .select("id")
      .single();
    if (error || !data) throw new HttpError(500, "Could not save Notion connection.");
    id = data.id;
  }
  const { error } = await db.from("notion_oauth_credentials").upsert(
    {
      connection_id: id,
      workspace_id: txn.workspaceId,
      access_token_enc: encryptWithKey(token.access_token, notionConfig().key),
      bot_id: token.bot_id ?? null,
      selected_database_id: null,
      selected_data_source_id: null,
      selected_parent_page_id: null,
      selected_destination_name: null,
      selected_destination_url: null,
      last_sync_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new HttpError(500, "Could not save Notion credentials.");
  await recordAudit({
    workspaceId: txn.workspaceId,
    userId: txn.userId,
    action: "connector.notion.connected",
    entity: "connector",
  });
  log(txn.workspaceId, "oauth", "success", started);
  return txn;
}
export async function disconnectNotion(workspaceId: string, userId: string) {
  const conn = await connection(workspaceId);
  if (!conn) return;
  const { error } = await db
    .from("notion_oauth_credentials")
    .delete()
    .eq("connection_id", conn.id)
    .eq("workspace_id", workspaceId);
  if (error) throw new HttpError(500, "Could not disconnect Notion.");
  const { error: updateError } = await db
    .from("workspace_connections")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", conn.id)
    .eq("workspace_id", workspaceId);
  if (updateError) throw new HttpError(500, "Could not disconnect Notion.");
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.disconnected",
    entity: "connector",
  });
}
export async function listNotionDestinations(workspaceId: string) {
  const { token } = await ready(workspaceId);
  const results: {
    id: string;
    databaseId: string | null;
    name: string;
    url: string | null;
    kind: "data_source" | "page";
    /** Data sources only: whether it can hold the Mellox calendar as it is. */
    fit: CalendarFit | null;
  }[] = [];
  let cursor: string | undefined;
  do {
    const page = await notionRequest(token, "/search", {
      method: "POST",
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    for (const item of page.results ?? []) {
      if (item.object !== "data_source" && item.object !== "page") continue;
      results.push({
        id: item.id,
        databaseId: item.parent?.database_id ?? null,
        name:
          item.object === "data_source"
            ? (item.title ?? []).map((p: any) => p.plain_text ?? p.text?.content ?? "").join("") ||
              "Untitled data source"
            : Object.values(item.properties ?? {})
                .flatMap((p: any) => p?.title ?? [])
                .map((p: any) => p.plain_text ?? p.text?.content ?? "")
                .join("") || "Untitled page",
        url: item.url ?? null,
        kind: item.object,
        fit: item.object === "data_source" ? calendarFit(item.properties) : null,
      });
    }
    cursor = page.has_more && typeof page.next_cursor === "string" ? page.next_cursor : undefined;
    if (results.length > 1000)
      throw new HttpError(413, "Too many shared Notion pages to list at once.");
  } while (cursor);
  return results;
}
/** The columns of a Mellox calendar. The first four are the ones sync cannot work without. */
const CALENDAR_PROPERTIES: Record<string, Record<string, object>> = {
  Name: { title: {} },
  Content: { rich_text: {} },
  "Mellox ID": { rich_text: {} },
  "Mellox Workspace ID": { rich_text: {} },
  Platform: { select: {} },
  Status: { select: {} },
  "Publish Date": { date: {} },
  "Content Type": { select: {} },
  "Asset URL": { url: {} },
  "Last Synced": { date: {} },
};
const REQUIRED_PROPERTIES = ["Name", "Content", "Mellox ID", "Mellox Workspace ID"];
const typeOf = (name: string) => Object.keys(CALENDAR_PROPERTIES[name])[0];
export type CalendarFit = "ready" | "addable" | "unfit";
/**
 * "addable": only missing columns stand in the way, and Mellox can add them.
 * A column that exists with another type is never changed, so that is "unfit".
 */
export function calendarFit(properties: Record<string, any> | null | undefined): CalendarFit {
  const has = (name: string) => properties?.[name]?.type === typeOf(name);
  if (REQUIRED_PROPERTIES.every(has)) return "ready";
  if (!has("Name")) return "unfit";
  return REQUIRED_PROPERTIES.some((name) => properties?.[name] && !has(name)) ? "unfit" : "addable";
}
async function dataSource(token: string, id: string, addColumns = false) {
  const path = `/data_sources/${encodeURIComponent(id)}`;
  let source = await notionRequest(token, path);
  if (source.object !== "data_source") throw new HttpError(400, "Choose a Notion database.");
  const fit = calendarFit(source.properties);
  if (fit === "addable" && addColumns) {
    // Only columns that do not exist yet; nothing a person made is touched.
    const missing = Object.fromEntries(
      Object.entries(CALENDAR_PROPERTIES).filter(([name]) => !source.properties?.[name]),
    );
    await notionRequest(token, path, {
      method: "PATCH",
      body: JSON.stringify({ properties: missing }),
    });
    source = await notionRequest(token, path);
  }
  if (calendarFit(source.properties) !== "ready")
    throw new HttpError(
      400,
      fit === "addable"
        ? "This database is missing the Mellox columns. Let Mellox add them, or create a new calendar."
        : "This database can't hold the Mellox calendar. Create a new calendar in a page instead.",
    );
  return source;
}
function safeNotionUrl(value: unknown, databaseId: string | null): string | null {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        ["notion.so", "www.notion.so", "notion.com", "www.notion.com"].includes(url.hostname)
      )
        return url.toString();
    } catch {
      /* use the verified database ID below */
    }
  }
  return databaseId ? `https://www.notion.so/${databaseId.replace(/-/g, "")}` : null;
}
export async function selectNotionDestination(
  workspaceId: string,
  userId: string,
  dataSourceId: string,
  addColumns = false,
) {
  const { conn, token } = await ready(workspaceId);
  const source = await dataSource(token, dataSourceId, addColumns);
  const databaseId = source.parent?.database_id ?? null;
  const name =
    (source.title ?? []).map((part: any) => part.plain_text ?? part.text?.content ?? "").join("") ||
    "Notion calendar";
  const { error } = await db
    .from("notion_oauth_credentials")
    .update({
      selected_data_source_id: dataSourceId,
      selected_database_id: databaseId,
      selected_destination_name: name,
      selected_destination_url: safeNotionUrl(source.url, databaseId),
      updated_at: new Date().toISOString(),
    })
    .eq("connection_id", conn.id)
    .eq("workspace_id", workspaceId);
  if (error) throw new HttpError(500, "Could not select Notion calendar.");
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.destination_selected",
    entity: "connector",
    payload: { dataSourceId },
  });
  return notionStatus(workspaceId);
}
export async function createNotionDestination(
  workspaceId: string,
  userId: string,
  parentPageId: string,
) {
  const { conn, token } = await ready(workspaceId);
  // Create is intentionally single attempt: an uncertain response may already have created it.
  const created = await notionRequest(token, "/databases", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: "Mellox Content Calendar" } }],
      initial_data_source: { properties: CALENDAR_PROPERTIES },
    }),
  });
  const details = created.data_sources?.length
    ? created
    : await notionRequest(token, `/databases/${encodeURIComponent(created.id)}`);
  const sourceId = details.data_sources?.[0]?.id;
  if (!sourceId)
    throw new HttpError(
      502,
      "Notion created the database, but its data source was not returned. Choose it from the list.",
    );
  const selected = await selectNotionDestination(workspaceId, userId, sourceId);
  const { error } = await db
    .from("notion_oauth_credentials")
    .update({ selected_parent_page_id: parentPageId })
    .eq("workspace_id", workspaceId)
    .eq("connection_id", conn.id);
  if (error) throw new HttpError(500, "Could not save Notion calendar parent.");
  return selected;
}

async function readBody(token: string, page: NotionObject) {
  const blocks = await notionRequest(
    token,
    `/blocks/${encodeURIComponent(page.id)}/children?page_size=100`,
  );
  const children: NotionObject[] = blocks.results ?? [];
  const markerIndex = children.findIndex(
    (block) =>
      block.type === "heading_3" &&
      block.heading_3?.rich_text?.[0]?.plain_text === "Mellox Content",
  );
  if (markerIndex < 0 && page.properties?.Content?.rich_text?.length) return undefined;
  const candidates = markerIndex < 0 ? children : children.slice(markerIndex + 1);
  const firstNonParagraph = candidates.findIndex((block) => block.type !== "paragraph");
  const bodyBlocks =
    markerIndex < 0
      ? candidates.filter((block) => block.type === "paragraph")
      : candidates.slice(0, firstNonParagraph < 0 ? undefined : firstNonParagraph);
  const text = bodyBlocks
    .filter((b: any) => b.type === "paragraph")
    .flatMap((b: any) => b.paragraph?.rich_text ?? [])
    .map((p: any) => p.plain_text ?? p.text?.content ?? "")
    .join("");
  return text || undefined;
}
function managedBodyBlocks(body: string) {
  return [
    {
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: [{ type: "text", text: { content: "Mellox Content" } }] },
    },
    ...notionBodyBlocks(body),
  ];
}
async function replaceBodyBlocks(token: string, pageId: string, body: string) {
  const children = await notionRequest(
    token,
    `/blocks/${encodeURIComponent(pageId)}/children?page_size=100`,
  );
  const blocks: NotionObject[] = children.results ?? [];
  const markerIndex = blocks.findIndex(
    (block) =>
      block.type === "heading_3" &&
      block.heading_3?.rich_text?.[0]?.plain_text === "Mellox Content",
  );
  const managed = markerIndex < 0 ? [] : blocks.slice(markerIndex);
  for (const [index, block] of managed.entries()) {
    if (index > 0 && block.type !== "paragraph") break;
    await notionRequest(token, `/blocks/${encodeURIComponent(block.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ in_trash: true }),
    });
  }
  if (body.length > 2000)
    await notionRequest(token, `/blocks/${encodeURIComponent(pageId)}/children`, {
      method: "PATCH",
      body: JSON.stringify({ children: managedBodyBlocks(body) }),
    });
}
async function sourcePages(token: string, sourceId: string) {
  const pages = await notionPages(token, sourceId);
  const rows: { page: NotionObject; record: CalendarRecord }[] = new Array(pages.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, pages.length) }, async () => {
      while (cursor < pages.length) {
        const index = cursor++;
        const page = pages[index];
        rows[index] = { page, record: fromNotion(page, await readBody(token, page)) };
      }
    }),
  );
  return rows;
}
async function mappings(workspaceId: string, sourceId: string): Promise<Mapping[]> {
  const { data, error } = await db
    .from("notion_content_mappings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("notion_data_source_id", sourceId);
  if (error) throw new HttpError(500, "Could not load Notion mappings.");
  return data as Mapping[];
}
async function items(workspaceId: string, ids?: string[]): Promise<ContentItem[]> {
  let q = db
    .from("content_items")
    .select(
      "id,workspace_id,agent,kind,channel,title,body,hashtags,media_url,status,scheduled_at,metrics,meta,created_by,created_at,updated_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .limit(5001);
  if (ids) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) throw new HttpError(500, "Could not load calendar content.");
  if ((data?.length ?? 0) > 5000)
    throw new HttpError(413, "Too many calendar items for one action. Use the current view.");
  return data as ContentItem[];
}
async function saveMapping(
  workspaceId: string,
  sourceId: string,
  item: ContentItem,
  page: NotionObject,
  direction: string,
  notionRecord: CalendarRecord,
) {
  const mHash = syncHash(fromMellox(item)),
    nHash = syncHash(notionRecord);
  const { error } = await db.from("notion_content_mappings").upsert(
    {
      workspace_id: workspaceId,
      content_item_id: item.id,
      notion_page_id: page.id,
      notion_data_source_id: sourceId,
      last_mellox_updated_at: item.updated_at,
      last_notion_edited_at: page.last_edited_time ?? null,
      last_sync_hash: mHash,
      last_mellox_hash: mHash,
      last_notion_hash: nHash,
      last_sync_direction: direction,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,content_item_id,notion_data_source_id" },
  );
  if (error) throw new HttpError(500, "Could not save Notion mapping.");
}
async function saveUnmappedConflict(
  workspaceId: string,
  sourceId: string,
  item: ContentItem,
  page: NotionObject,
) {
  const { error } = await db.from("notion_content_mappings").insert({
    workspace_id: workspaceId,
    content_item_id: item.id,
    notion_page_id: page.id,
    notion_data_source_id: sourceId,
    last_mellox_hash: "unreconciled",
    last_notion_hash: "unreconciled",
    last_sync_direction: "conflict",
    last_mellox_updated_at: item.updated_at,
    last_notion_edited_at: page.last_edited_time ?? null,
  });
  if (error) throw new HttpError(500, "Could not record Notion conflict.");
}
async function markMappedConflict(workspaceId: string, mappingId: string) {
  const { error } = await db
    .from("notion_content_mappings")
    .update({
      last_mellox_hash: "requires-review",
      last_notion_hash: "requires-review",
      last_sync_direction: "conflict",
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("id", mappingId);
  if (error) throw new HttpError(500, "Could not record Notion conflict.");
}
async function touchSync(workspaceId: string, connectionId: string) {
  const { error } = await db
    .from("notion_oauth_credentials")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connectionId);
  if (error) throw new HttpError(500, "Could not save Notion sync status.");
}
export async function exportNotion(
  workspaceId: string,
  userId: string,
  requestedIds?: string[],
  conflictIds?: Set<string>,
) {
  const started = Date.now();
  const { conn, cred, token } = await ready(workspaceId, true);
  const sourceId = cred.selected_data_source_id!;
  const source = await dataSource(token, sourceId);
  const existing = await mappings(workspaceId, sourceId);
  const byItem = new Map(existing.map((m) => [m.content_item_id, m]));
  const remote = await sourcePages(token, sourceId);
  const remoteIds = new Map<string, number>();
  for (const row of remote)
    if (row.record.workspaceId === workspaceId && row.record.melloxId)
      remoteIds.set(row.record.melloxId, (remoteIds.get(row.record.melloxId) ?? 0) + 1);
  const byPage = new Map(remote.map((p) => [p.page.id, p]));
  const byMellox = new Map(
    remote
      .filter((p) => p.record.workspaceId === workspaceId)
      .filter((p) => !!p.record.melloxId)
      .map((p) => [p.record.melloxId!, p]),
  );
  const chosen = await items(workspaceId, requestedIds);
  if (requestedIds && chosen.length !== new Set(requestedIds).size)
    throw new HttpError(404, "One or more content items are unavailable in this workspace.");
  const counts = { exported: 0, updated: 0, skipped: 0, conflicts: 0, failed: 0 };
  const conflict = (id: string) => {
    counts.conflicts++;
    conflictIds?.add(id);
  };
  for (const item of chosen) {
    try {
      const record = fromMellox(item);
      if ((remoteIds.get(item.id) ?? 0) > 1) {
        conflict(item.id);
        continue;
      }
      const mapped = byItem.get(item.id);
      const found = mapped ? byPage.get(mapped.notion_page_id) : byMellox.get(item.id);
      if (mapped && !found) {
        conflict(item.id);
        continue;
      }
      const decision =
        found && mapped
          ? decideSync(
              syncHash(record),
              syncHash(found.record),
              mapped.last_mellox_hash,
              mapped.last_notion_hash,
            )
          : "unknown";
      if (decision === "import" || (decision === "unknown" && !!mapped)) {
        conflict(item.id);
        continue;
      }
      if (found && mapped && decision === "conflict") {
        conflict(item.id);
        continue;
      }
      if (found && !mapped && syncHash(record) !== syncHash(found.record)) {
        await saveUnmappedConflict(workspaceId, sourceId, item, found.page);
        conflict(item.id);
        continue;
      }
      if (found && syncHash(record) === syncHash(found.record)) {
        await saveMapping(workspaceId, sourceId, item, found.page, "skip", found.record);
        counts.skipped++;
        continue;
      }
      let page: NotionObject;
      const properties = notionProperties(record, source.properties);
      if (found) {
        page = await notionRequest(token, `/pages/${encodeURIComponent(found.page.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ properties }),
        });
        // Replace paragraph blocks only when body changed; old blocks are archived first.
        if (record.body !== found.record.body) {
          await replaceBodyBlocks(token, page.id, record.body);
        }
        counts.updated++;
      } else {
        page = await notionRequest(token, "/pages", {
          method: "POST",
          body: JSON.stringify({
            parent: { type: "data_source_id", data_source_id: sourceId },
            properties,
            children: record.body.length > 2000 ? managedBodyBlocks(record.body) : [],
          }),
        });
        counts.exported++;
      }
      await saveMapping(
        workspaceId,
        sourceId,
        item,
        page,
        found ? "export_update" : "export",
        record,
      );
    } catch (error) {
      await noteConnectionFailure(conn.id, workspaceId, error);
      counts.failed++;
    }
  }
  await touchSync(workspaceId, conn.id);
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.exported",
    entity: "connector",
    payload: counts,
  });
  if (counts.conflicts)
    await recordAudit({
      workspaceId,
      userId,
      action: "connector.notion.conflict",
      entity: "connector",
      payload: { operation: "export", count: counts.conflicts },
    });
  log(workspaceId, "export", counts.failed ? "partial" : "success", started, counts);
  return counts;
}

const CHANNELS = new Set([
  "instagram",
  "x",
  "linkedin",
  "facebook",
  "tiktok",
  "youtube",
  "threads",
  "blog",
  "email",
  "web",
]);
const KINDS = new Set([
  "post",
  "carousel",
  "story",
  "image",
  "video",
  "ad",
  "script",
  "blog",
  "brief",
  "email",
  "landing",
]);
function validateImport(record: CalendarRecord, workspaceId: string) {
  if (record.malformedDate) return "Publish Date is invalid.";
  if (record.workspaceId && record.workspaceId !== workspaceId)
    return "This row belongs to another Mellox workspace.";
  if (!record.title.trim() && !record.body.trim()) return "Add a name or content.";
  if (record.title.length > 280 || record.body.length > 40000)
    return "Content exceeds Mellox limits.";
  if (record.channel && !CHANNELS.has(record.channel)) return "Platform is not supported.";
  if (record.kind && !KINDS.has(record.kind)) return "Content type is not supported.";
  if (record.mediaUrl) {
    try {
      new URL(record.mediaUrl);
    } catch {
      return "Asset URL is invalid.";
    }
  }
  return null;
}
export async function previewNotionImport(workspaceId: string) {
  const { cred, token } = await ready(workspaceId, true);
  const sourceId = cred.selected_data_source_id!;
  const remote = await sourcePages(token, sourceId);
  const known = await mappings(workspaceId, sourceId);
  const mappedPages = new Set(known.map((m) => m.notion_page_id));
  const ids = remote.map((p) => p.record.melloxId).filter((id): id is string => !!id);
  const frequency = new Map<string, number>();
  for (const id of ids) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  const owned = new Set((await items(workspaceId, ids)).map((item) => item.id));
  const rows = remote.map(({ page, record }) => {
    const error =
      record.melloxId && (frequency.get(record.melloxId) ?? 0) > 1
        ? "Duplicate Mellox ID in Notion."
        : validateImport(record, workspaceId);
    const duplicate = mappedPages.has(page.id) || (!!record.melloxId && owned.has(record.melloxId));
    return {
      pageId: page.id,
      title: record.title || "Untitled content",
      valid: !error,
      duplicate,
      error,
    };
  });
  return {
    total: rows.length,
    valid: rows.filter((r) => r.valid).length,
    invalid: rows.filter((r) => !r.valid).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    rows,
  };
}
export async function importNotion(
  workspaceId: string,
  userId: string,
  supabase: UserSupabaseClient,
  previewedPageIds?: string[],
  conflictIds?: Set<string>,
) {
  const started = Date.now();
  const { conn, cred, token } = await ready(workspaceId, true);
  const sourceId = cred.selected_data_source_id!;
  const remote = (await sourcePages(token, sourceId)).filter(({ page }) =>
    previewedPageIds ? previewedPageIds.includes(page.id) : true,
  );
  const known = await mappings(workspaceId, sourceId);
  const byPage = new Map(known.map((m) => [m.notion_page_id, m]));
  const frequency = new Map<string, number>();
  for (const row of remote)
    if (row.record.melloxId)
      frequency.set(row.record.melloxId, (frequency.get(row.record.melloxId) ?? 0) + 1);
  const counts = { imported: 0, updated: 0, skipped: 0, invalid: 0, conflicts: 0, failed: 0 };
  const conflict = (id: string) => {
    counts.conflicts++;
    conflictIds?.add(id);
  };
  for (const { page, record } of remote) {
    try {
      if (validateImport(record, workspaceId)) {
        counts.invalid++;
        continue;
      }
      if (record.melloxId && (frequency.get(record.melloxId) ?? 0) > 1) {
        counts.invalid++;
        continue;
      }
      const mapped = byPage.get(page.id);
      const itemId =
        mapped?.content_item_id ?? (record.workspaceId === workspaceId ? record.melloxId : null);
      const existing = itemId ? (await items(workspaceId, [itemId]))[0] : undefined;
      if (itemId && !existing) {
        counts.invalid++;
        continue;
      }
      if (existing && !mapped) {
        await saveUnmappedConflict(workspaceId, sourceId, existing, page);
        conflict(existing.id);
        continue;
      }
      let item: ContentItem;
      if (existing) {
        const decision = mapped
          ? decideSync(
              syncHash(fromMellox(existing)),
              syncHash(record),
              mapped.last_mellox_hash,
              mapped.last_notion_hash,
            )
          : "import";
        if (decision === "conflict" || decision === "export") {
          conflict(existing.id);
          continue;
        }
        if (decision === "skip") {
          counts.skipped++;
          continue;
        }
        if (["scheduled", "publishing", "published"].includes(existing.status)) {
          if (mapped) await markMappedConflict(workspaceId, mapped.id);
          conflict(existing.id);
          continue;
        }
        item = await updateImportedContentItem(supabase, workspaceId, existing.id, {
          title: record.title || null,
          body: record.body || null,
          channel: record.channel,
          kind: record.kind,
          media_url: record.mediaUrl,
          scheduled_at: record.scheduledAt,
        });
        counts.updated++;
      } else {
        item = await createImportedContentItem(supabase, userId, {
          workspaceId,
          agent: "spark",
          title: record.title || null,
          body: record.body || null,
          channel: record.channel as any,
          kind: record.kind as any,
          media_url: record.mediaUrl,
          scheduled_at: record.scheduledAt,
          meta: { source: "notion" },
        });
        counts.imported++;
      }
      await saveMapping(
        workspaceId,
        sourceId,
        item,
        page,
        existing ? "import_update" : "import",
        record,
      );
    } catch (error) {
      await noteConnectionFailure(conn.id, workspaceId, error);
      counts.failed++;
    }
  }
  await touchSync(workspaceId, conn.id);
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.imported",
    entity: "connector",
    payload: counts,
  });
  if (counts.conflicts)
    await recordAudit({
      workspaceId,
      userId,
      action: "connector.notion.conflict",
      entity: "connector",
      payload: { operation: "import", count: counts.conflicts },
    });
  log(workspaceId, "import", counts.failed ? "partial" : "success", started, counts);
  return counts;
}
export async function syncNotion(
  workspaceId: string,
  userId: string,
  supabase: UserSupabaseClient,
) {
  const started = Date.now();
  const conflictIds = new Set<string>();
  const imported = await importNotion(workspaceId, userId, supabase, undefined, conflictIds);
  const exported = await exportNotion(workspaceId, userId, undefined, conflictIds);
  const counts = {
    imported: imported.imported,
    exported: exported.exported,
    updated: imported.updated + exported.updated,
    skipped: exported.skipped,
    conflicts: conflictIds.size,
    failed: imported.failed + exported.failed,
  };
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.synced",
    entity: "connector",
    payload: counts,
  });
  log(workspaceId, "sync", counts.failed ? "partial" : "success", started, counts);
  return counts;
}
export async function resolveNotionConflict(
  workspaceId: string,
  userId: string,
  supabase: UserSupabaseClient,
  mappingId: string,
  keep: "mellox" | "notion",
) {
  const { cred, token } = await ready(workspaceId, true);
  const { data: mapped } = await db
    .from("notion_content_mappings")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", mappingId)
    .eq("notion_data_source_id", cred.selected_data_source_id)
    .maybeSingle();
  if (!mapped) throw new HttpError(404, "Conflict is unavailable.");
  const page = await notionRequest(token, `/pages/${encodeURIComponent(mapped.notion_page_id)}`);
  const record = fromNotion(page, await readBody(token, page));
  const item = (await items(workspaceId, [mapped.content_item_id]))[0];
  if (!item) throw new HttpError(404, "Content item is unavailable.");
  if (keep === "notion") {
    const invalid = validateImport(record, workspaceId);
    if (invalid) throw new HttpError(400, invalid);
    await updateImportedContentItem(supabase, workspaceId, item.id, {
      title: record.title || null,
      body: record.body || null,
      channel: record.channel,
      kind: record.kind,
      media_url: record.mediaUrl,
      scheduled_at: record.scheduledAt,
    });
  } else {
    await notionRequest(token, `/pages/${encodeURIComponent(page.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ properties: notionProperties(fromMellox(item)) }),
    });
    await replaceBodyBlocks(token, page.id, item.body ?? "");
  }
  const refreshed = (await items(workspaceId, [item.id]))[0];
  await saveMapping(
    workspaceId,
    cred.selected_data_source_id!,
    refreshed,
    page,
    `resolve_${keep}`,
    keep === "notion" ? record : fromMellox(refreshed),
  );
  await recordAudit({
    workspaceId,
    userId,
    action: "connector.notion.conflict_resolved",
    entity: "connector",
    payload: { mappingId, keep },
  });
  return { resolved: true };
}
export async function notionConflicts(workspaceId: string) {
  const { cred, token } = await ready(workspaceId, true);
  const remote = await sourcePages(token, cred.selected_data_source_id!);
  const byPage = new Map(remote.map((r) => [r.page.id, r]));
  const known = await mappings(workspaceId, cred.selected_data_source_id!);
  const local = await items(
    workspaceId,
    known.map((m) => m.content_item_id),
  );
  const byItem = new Map(local.map((item) => [item.id, item]));
  return known.flatMap((m) => {
    const notion = byPage.get(m.notion_page_id),
      mellox = byItem.get(m.content_item_id);
    if (!notion || !mellox) return [];
    return decideSync(
      syncHash(fromMellox(mellox)),
      syncHash(notion.record),
      m.last_mellox_hash,
      m.last_notion_hash,
    ) === "conflict"
      ? [{ mappingId: m.id, mellox: fromMellox(mellox), notion: notion.record }]
      : [];
  });
}
