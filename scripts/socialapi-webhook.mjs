#!/usr/bin/env node
// socialapi-webhook.mjs — manage the SocialAPI.ai webhook endpoint for this
// deployment. Operator tool; reads SOCIALAPI_API_KEY from the environment or .env.
//
//   node scripts/socialapi-webhook.mjs status
//   node scripts/socialapi-webhook.mjs register [--url https://app.example.com] [--env-file .env]
//   node scripts/socialapi-webhook.mjs test <webhook-id>
//
// `register` points the endpoint at <APP_URL>/api/public/hooks/socialapi. The
// deployment must already be live over HTTPS: SocialAPI pings the URL during
// registration and refuses to save an unreachable endpoint. The signing secret
// is returned ONCE; it is written to the env file as SOCIALAPI_WEBHOOK_SECRET
// and only its last four characters are printed. Set the same value in your
// hosting provider's variables (e.g. Railway) and redeploy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const EVENTS = [
  "post.scheduled",
  "post.published",
  "post.partial",
  "post.failed",
  "post.updated",
  "post.deleted",
  "post.unpublished",
  "post.retried",
  "account.connected",
  "account.disconnected",
  "account.updated",
  "page.removed",
];

const args = process.argv.slice(2);
const command = args[0];
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const envFile = flag("env-file") ?? ".env";

if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* fall back to the process environment */
  }
}

const key = process.env.SOCIALAPI_API_KEY;
const base = (process.env.SOCIALAPI_BASE_URL || "https://api.social-api.ai/v1").replace(/\/+$/, "");
if (!key) {
  console.error("SOCIALAPI_API_KEY is not set (environment or --env-file).");
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function upsertEnv(file, name, value) {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  const idx = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (idx >= 0) lines[idx] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  writeFileSync(file, lines.join("\n").replace(/\n*$/, "\n"));
}

if (command === "status") {
  const { status, data } = await call("GET", "/webhooks");
  if (status !== 200) {
    console.error(`GET /webhooks → ${status}`, data?.error?.code ?? "");
    process.exit(1);
  }
  const hooks = data?.data ?? [];
  if (!hooks.length) console.log("No webhook endpoints registered.");
  for (const h of hooks) {
    console.log(`${h.id}  ${h.is_active === false ? "inactive" : "active"}  ${h.url}`);
    console.log(`  events: ${(h.events ?? []).join(", ")}`);
  }
} else if (command === "register") {
  const origin = (flag("url") ?? process.env.APP_URL ?? "").replace(/\/+$/, "");
  if (!/^https:\/\//.test(origin)) {
    console.error(
      "A public https origin is required (--url or APP_URL). SocialAPI rejects http endpoints.",
    );
    process.exit(1);
  }
  const url = `${origin}/api/public/hooks/socialapi`;
  const existing = await call("GET", "/webhooks");
  const dupe = (existing.data?.data ?? []).find((h) => h.url === url);
  if (dupe) {
    console.error(
      `An endpoint for ${url} already exists (${dupe.id}). Delete it in the SocialAPI dashboard to rotate its secret.`,
    );
    process.exit(1);
  }
  const { status, data } = await call("POST", "/webhooks", { url, events: EVENTS });
  if (status !== 201 || !data?.secret) {
    console.error(
      `POST /webhooks → ${status}`,
      data?.error?.code ?? "",
      data?.error?.message ?? "",
    );
    process.exit(1);
  }
  upsertEnv(envFile, "SOCIALAPI_WEBHOOK_SECRET", data.secret);
  console.log(`Registered ${data.id} → ${url}`);
  console.log(
    `Signing secret (…${data.secret.slice(-4)}) written to ${envFile} as SOCIALAPI_WEBHOOK_SECRET.`,
  );
  console.log("Set the same value in your deployment's environment variables and redeploy.");
} else if (command === "test") {
  const id = args[1];
  if (!id) {
    console.error("Usage: socialapi-webhook.mjs test <webhook-id>");
    process.exit(1);
  }
  const { status, data } = await call("POST", `/webhooks/${encodeURIComponent(id)}/test`);
  console.log(`POST /webhooks/${id}/test → ${status}`, data?.error?.code ?? "");
  process.exit(status >= 200 && status < 300 ? 0 : 1);
} else {
  console.log("Usage: node scripts/socialapi-webhook.mjs <status|register|test> [options]");
  process.exit(command ? 1 : 0);
}
