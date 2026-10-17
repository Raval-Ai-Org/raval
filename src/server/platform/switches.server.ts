// Emergency switches — the runtime half of the admin console's Emergency page.
//
// An admin can stop a paid area (text, images, video, web search) for the whole
// platform. The gateways already ask `checkBudget` before they spend, so that is
// the one place this is read. It FAILS OPEN like the budget check itself: a
// missing row or an unreadable table means the area keeps running, because a
// broken lookup must not take the product down. The answer is cached for a few
// seconds per process, so a flip reaches every instance within that time.
import "server-only";

export const SWITCH_KEYS = ["ai_text", "ai_image", "ai_video", "ai_search"] as const;
export type SwitchKey = (typeof SWITCH_KEYS)[number];

export const SWITCH_MESSAGES: Record<SwitchKey, string> = {
  ai_text: "AI writing is paused for maintenance. Please try again shortly.",
  ai_image: "Image generation is paused for maintenance. Please try again shortly.",
  ai_video: "Video generation is paused for maintenance. Please try again shortly.",
  ai_search: "Web research is paused for maintenance. Please try again shortly.",
};

const KIND_TO_SWITCH = {
  text: "ai_text",
  image: "ai_image",
  video: "ai_video",
  search: "ai_search",
} as const satisfies Record<string, SwitchKey>;

const TTL_MS = 10_000;

export type SwitchReader = () => Promise<Record<string, boolean>>;

const defaultReader: SwitchReader = async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (
    supabaseAdmin as unknown as import("@supabase/supabase-js").SupabaseClient
  )
    .from("platform_switches")
    .select("key, engaged");
  if (error) throw new Error(error.message);
  const out: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ key: string; engaged: boolean }>) {
    out[row.key] = row.engaged === true;
  }
  return out;
};

let reader: SwitchReader = defaultReader;
let cached: { at: number; value: Record<string, boolean> } | null = null;

/** Tests inject a reader. */
export function setSwitchReader(next: SwitchReader | null): void {
  reader = next ?? defaultReader;
  cached = null;
}

/** Forget the cached answer (used right after an admin flips a switch). */
export function clearSwitchCache(): void {
  cached = null;
}

async function engagedMap(): Promise<Record<string, boolean>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const value = await reader();
    cached = { at: Date.now(), value };
    return value;
  } catch (error) {
    console.error(
      "[switches] read failed, failing open",
      error instanceof Error ? error.message : error,
    );
    // Keep the last known answer through a short outage rather than guessing.
    return cached?.value ?? {};
  }
}

/** The message to show when this kind of paid call is stopped, else null. */
export async function switchBlockFor(kind: keyof typeof KIND_TO_SWITCH): Promise<string | null> {
  const key = KIND_TO_SWITCH[kind];
  const map = await engagedMap();
  return map[key] ? SWITCH_MESSAGES[key] : null;
}
