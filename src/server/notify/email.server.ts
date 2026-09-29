import "server-only";

// Transactional email through Resend. The only file that reads RESEND_API_KEY
// or talks to api.resend.com. With no key (or no sender) every call is a
// logged no-op, so in-app notices keep working on their own.

export type EmailMessage = {
  to: string | string[];
  subject: string;
  /** Plain text; rendered into a simple, readable HTML body. */
  text: string;
  replyTo?: string;
  /** Optional button: [label, absolute URL]. */
  action?: [string, string];
};

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.BILLING_EMAIL_FROM);
}

export function appUrl(path = "/"): string {
  const base = (
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:8080"
  ).replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmailHtml(message: Pick<EmailMessage, "subject" | "text" | "action">) {
  const paragraphs = message.text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const button = message.action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(message.action[1])}" style="background:#b6e34a;color:#111;padding:11px 20px;border-radius:999px;text-decoration:none;font-weight:600">${escapeHtml(message.action[0])}</a></p>`
    : "";
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;color:#1b1f23;max-width:520px;margin:0 auto;padding:24px"><h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(message.subject)}</h2>${paragraphs}${button}<p style="margin-top:28px;font-size:12px;color:#6b7280">Mellox AI</p></div>`;
}

/** Returns true when Resend accepted the message. Never throws. */
export async function sendEmail(message: EmailMessage): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BILLING_EMAIL_FROM;
  const to = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (!key || !from || to.length === 0) {
    console.info("[email] skipped (not configured):", message.subject);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: message.subject,
        text: message.action
          ? `${message.text}\n\n${message.action[0]}: ${message.action[1]}`
          : message.text,
        html: renderEmailHtml(message),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error("[email] Resend refused the message", response.status);
      return false;
    }
    return true;
  } catch (cause) {
    console.error("[email] send failed", cause instanceof Error ? cause.message : cause);
    return false;
  }
}
