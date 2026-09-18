// return-url.ts — where an external OAuth / install flow may hand the user
// back to. Shared by the GitHub and Google connectors: each provider has one
// registered callback URL, but Mellox runs on several origins (custom domain,
// Railway domain, localhost), and a session lives only on the origin that
// started the flow.
import "server-only";

type Env = Record<string, string | undefined>;

/**
 * The normalized origin when `candidate` is one of this deployment's public
 * origins (APP_URL, NEXT_PUBLIC_APP_URL), one of `extraOrigins`
 * (comma-separated), or — when `allowLocal` — a localhost development server.
 * Otherwise null.
 */
export function allowedReturnOriginFrom(
  candidate: string | null | undefined,
  env: Env,
  opts: { allowLocal: boolean; extraOrigins?: string },
): string | null {
  if (!candidate) return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (/^(localhost|127\.0\.0\.1)$/i.test(url.hostname)) return opts.allowLocal ? url.origin : null;
  if (url.protocol !== "https:") return null;
  const allowed = [env.APP_URL, env.NEXT_PUBLIC_APP_URL, ...(opts.extraOrigins ?? "").split(",")]
    .flatMap((raw) => {
      try {
        return raw?.trim() ? [new URL(raw.trim()).origin] : [];
      } catch {
        return [];
      }
    });
  return allowed.includes(url.origin) ? url.origin : null;
}

/**
 * The in-app page to return to after connecting: a same-origin relative path
 * (e.g. "/app?settings=connections"), or null when absent or unsafe.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > 300) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  if (/\p{Cc}/u.test(value)) return null;
  const base = "https://return-path.invalid";
  try {
    const url = new URL(value, base);
    if (url.origin !== base) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
