// Where a Composio-connected social account can post (ADR-0042, Phase 2).
// Pure: reads the result of one lookup tool per network into destinations.
// Each destination becomes its own `social_accounts` row (a Facebook Page, a
// Pinterest board), so the publish picker lists them like any other account.
//
// Composio wraps some results in `data` (and Graph lists in `data.data`), so
// every reader looks at both levels. Anything without an id is dropped.
import type { ComposioSocialPlatform } from "./requests";

export type Destination = {
  /** The id the posting tool needs (see ComposioTarget.destination). */
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/** The lookup tool per network, with its arguments. Every slug is a catalog read tool. */
export const DESTINATION_LOOKUP: Record<
  ComposioSocialPlatform,
  { tool: string; args: Record<string, unknown> }
> = {
  instagram: {
    tool: "INSTAGRAM_GET_USER_INFO",
    args: { ig_user_id: "me", fields: "id,username,name,profile_picture_url" },
  },
  facebook: { tool: "FACEBOOK_LIST_MANAGED_PAGES", args: {} },
  linkedin: { tool: "LINKEDIN_GET_MY_INFO", args: {} },
  pinterest: { tool: "PINTEREST_LIST_BOARDS", args: {} },
  youtube: { tool: "YOUTUBE_LIST_CHANNELS", args: { mine: true, part: "snippet" } },
};

/** At most this many destinations per connection (Pages, boards). */
export const MAX_DESTINATIONS = 10;

/** `social_accounts.provider_account_id` for a Composio destination. */
export function destinationAccountId(integrationAccountId: string, destination: string): string {
  return `${integrationAccountId}:${destination}`;
}

/** The two halves of a Composio `provider_account_id`, or null. */
export function parseDestinationAccountId(
  value: string,
): { integrationAccountId: string; destination: string } | null {
  const at = value.indexOf(":");
  if (at <= 0 || at === value.length - 1) return null;
  return { integrationAccountId: value.slice(0, at), destination: value.slice(at + 1) };
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : null;
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** The record itself, or its `data` when Composio wrapped it. */
function unwrap(data: unknown): Obj | null {
  const top = obj(data);
  if (!top) return null;
  const inner = obj(top.data);
  return inner && !Array.isArray(top.data) ? inner : top;
}

/** The first array found at data, data.data, items, data.items, elements... */
function list(data: unknown): Obj[] {
  const candidates: unknown[] = [];
  const top = obj(data);
  if (Array.isArray(data)) candidates.push(data);
  if (top) {
    candidates.push(top.data, top.items, top.elements, top.boards, top.pages);
    const inner = obj(top.data);
    if (inner) candidates.push(inner.data, inner.items, inner.elements, inner.boards, inner.pages);
  }
  const found = candidates.find((c) => Array.isArray(c)) as unknown[] | undefined;
  return (found ?? []).map(obj).filter((x): x is Obj => x !== null);
}

function picture(record: Obj): string | null {
  const direct = str(record.profile_picture_url) ?? str(record.picture);
  if (direct && /^https:\/\//.test(direct)) return direct;
  const nested = str(obj(obj(record.picture)?.data)?.url);
  return nested && /^https:\/\//.test(nested) ? nested : null;
}

/** The destinations in a lookup tool's result. */
export function readDestinations(platform: ComposioSocialPlatform, data: unknown): Destination[] {
  const out: Destination[] = [];
  switch (platform) {
    case "instagram": {
      const me = unwrap(data);
      const id = str(me?.id);
      if (me && id) {
        out.push({
          id,
          username: str(me.username),
          displayName: str(me.name),
          avatarUrl: picture(me),
        });
      }
      break;
    }
    case "facebook":
      for (const page of list(data)) {
        const id = str(page.id);
        if (id)
          out.push({ id, username: null, displayName: str(page.name), avatarUrl: picture(page) });
      }
      break;
    case "linkedin": {
      const me = unwrap(data);
      if (!me) break;
      // The LinkedIn API answers with `id`; the OpenID profile with `sub`.
      const raw = str(me.id) ?? str(me.sub);
      if (!raw) break;
      const id = raw.startsWith("urn:li:") ? raw : `urn:li:person:${raw}`;
      const first = str(me.localizedFirstName) ?? str(me.given_name);
      const last = str(me.localizedLastName) ?? str(me.family_name);
      const name = str(me.name) ?? ([first, last].filter(Boolean).join(" ") || null);
      out.push({ id, username: null, displayName: name, avatarUrl: picture(me) });
      break;
    }
    case "pinterest":
      for (const board of list(data)) {
        const id = str(board.id);
        if (id) out.push({ id, username: null, displayName: str(board.name), avatarUrl: null });
      }
      break;
    case "youtube":
      for (const channel of list(data)) {
        const id = str(channel.id);
        if (!id) continue;
        const snippet = obj(channel.snippet);
        const thumb = str(obj(obj(snippet?.thumbnails)?.default)?.url);
        out.push({
          id,
          username: str(snippet?.customUrl),
          displayName: str(snippet?.title),
          avatarUrl: thumb && /^https:\/\//.test(thumb) ? thumb : null,
        });
      }
      break;
  }
  const seen = new Set<string>();
  return out.filter((d) => !seen.has(d.id) && seen.add(d.id)).slice(0, MAX_DESTINATIONS);
}
