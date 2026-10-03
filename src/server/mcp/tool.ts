// The shape of an MCP tool, and the output cleaner every result passes through.
import "server-only";
import { z } from "zod";
import type { WorkspaceRole } from "@/server/api-auth";
import type { McpCaller } from "./access.server";

export type ToolContext = {
  caller: McpCaller;
  /** Set for workspace tools, after membership, role and the MCP switch were checked. */
  workspaceId: string;
  role: WorkspaceRole;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  /** Zod shape. Workspace tools get `workspaceId` added automatically. */
  input: z.ZodRawShape;
  /** "workspace" tools act on one verified workspace; "account" tools span the caller's own. */
  scope: "workspace" | "account";
  /** Checked here first; the function behind the tool checks its own role again. */
  minRole: WorkspaceRole;
  /** Changes something or can spend. Needs the workspace's "allow changes" switch. */
  write: boolean;
  /** Removes something that can't be brought back. */
  destructive?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
};

export const workspaceIdInput = {
  workspaceId: z
    .string()
    .uuid()
    .describe("The workspace (brand or client) to act on. Get ids from list_workspaces."),
};

export const uuid = z.string().uuid();

const SECRET_KEY =
  /token|secret|password|authorization|api_?key|private_?key|storage_?path|provider_?(post_|task_)?id|_post_id$|sdr_job|installation_?id|ciphertext|^email$|_email$/i;
const MAX_STRING = 6_000;
const MAX_ARRAY = 200;
const MAX_DEPTH = 8;

/**
 * Everything a tool returns goes through here: keys that could hold a
 * credential, a storage path, a provider id or an email are dropped, and very
 * long text and lists are cut so an answer stays readable.
 */
export function cleanOutput(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => cleanOutput(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] = cleanOutput(item, depth + 1);
  }
  return out;
}

/** MCP structured results are objects; wrap anything else. */
export function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return Array.isArray(value) ? { items: value } : { result: value ?? null };
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Run a part of a summary; a part that fails is reported as unavailable, not as a failed call. */
export async function soft<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}
