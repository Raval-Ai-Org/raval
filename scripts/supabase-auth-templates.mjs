// Generates the six ready-to-paste Supabase Dashboard auth email bodies.
// Keep the Go template expressions intact: Supabase renders them when sending.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const output = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "email-templates");
const base = "https://mellox.ai/auth/confirm#token_hash={{ .TokenHash }}&amp;type=";
const messages = [
  {
    file: "confirmation.html",
    type: "email",
    eyebrow: "ACCOUNT SETUP",
    heading: "Confirm your email",
    body: "You’re one step away from your Mellox AI workspace. Confirm this email address to finish setting up your account.",
    button: "Confirm email",
    note: "If you didn’t create a Mellox AI account, you can ignore this email.",
  },
  {
    file: "recovery.html",
    type: "recovery",
    eyebrow: "ACCOUNT SECURITY",
    heading: "Reset your password",
    body: "We received a request to reset your Mellox AI password. Continue to choose a new one.",
    button: "Reset password",
    note: "If you didn’t request a password reset, you can ignore this email. Your password has not changed.",
  },
  {
    file: "invite.html",
    type: "invite",
    eyebrow: "YOU’RE INVITED",
    heading: "Your invitation to Mellox AI",
    body: "You’ve been invited to Mellox AI. Accept the invitation to open your workspace.",
    button: "Accept invitation",
    note: "If you weren’t expecting this invitation, you can ignore this email.",
  },
  {
    file: "magic-link.html",
    type: "magiclink",
    eyebrow: "SIGN IN",
    heading: "Your sign-in link",
    body: "Use this one-time link to sign in to Mellox AI.",
    button: "Sign in",
    note: "If you didn’t ask to sign in, you can ignore this email.",
  },
  {
    file: "email-change.html",
    type: "email_change",
    eyebrow: "ACCOUNT SECURITY",
    heading: "Confirm your new email",
    body: "Confirm the email change requested for your Mellox AI account. Depending on your account settings, Supabase may ask you to confirm from both addresses.",
    button: "Confirm email change",
    note: "If you didn’t request this change, do not confirm it. Sign in to your account to review your settings.",
  },
  {
    file: "reauthentication.html",
    type: null,
    eyebrow: "SECURITY CHECK",
    heading: "Your verification code",
    body: "Use this one-time code to confirm a sensitive action in Mellox AI.",
    button: null,
    note: "If you didn’t request this code, you can ignore this email.",
  },
];

function render(message) {
  const action = message.type
    ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;"><tr><td bgcolor="#CBE960" style="border-radius:12px;"><a href="${base}${message.type}" style="display:inline-block;padding:16px 25px;border:1px solid #CBE960;border-radius:12px;color:#172025;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:20px;text-decoration:none;">${message.button}</a></td></tr></table>`
    : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;width:100%;"><tr><td style="padding:20px;border:1px solid #3B474D;border-radius:12px;background:#202B30;color:#CBE960;font-family:Consolas,Menlo,monospace;font-size:28px;font-weight:700;letter-spacing:7px;text-align:center;">{{ .Token }}</td></tr></table>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>${message.heading} · Mellox AI</title>
<style>@media only screen and (max-width:620px){.outer{padding:20px 12px!important}.inner{padding:28px 24px!important}.heading{font-size:27px!important;line-height:34px!important}}</style></head>
<body style="margin:0;padding:0;background:#10191D;color:#F4F7F2;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:#10191D;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${message.body}</div>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;background:#10191D;"><tr><td class="outer" align="center" style="padding:48px 16px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="560" style="width:100%;max-width:560px;border:1px solid #364248;border-radius:20px;background:#1A252A;">
<tr><td class="inner" style="padding:40px 42px 36px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td valign="middle" style="padding-right:12px;"><img src="https://mellox.ai/assets/mellox-email-mark.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border:0;border-radius:9px;"></td><td valign="middle" style="color:#F4F7F2;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:700;letter-spacing:-0.4px;">Mellox <span style="color:#CBE960;">AI</span></td></tr></table>
<p style="margin:42px 0 12px;color:#CBE960;font-size:11px;font-weight:700;letter-spacing:2px;line-height:18px;">${message.eyebrow}</p>
<h1 class="heading" style="margin:0;color:#F4F7F2;font-size:32px;font-weight:700;letter-spacing:-0.7px;line-height:39px;">${message.heading}</h1>
<p style="margin:18px 0 0;color:#BFC9C5;font-size:16px;line-height:26px;">${message.body}</p>
${action}
<p style="margin:29px 0 0;padding-top:22px;border-top:1px solid #364248;color:#9FAEAA;font-size:13px;line-height:21px;">${message.note}</p>
</td></tr></table>
<p style="margin:22px 0 0;color:#82918E;font-size:12px;line-height:18px;text-align:center;">Mellox AI · Marketing Intelligence Layer</p>
</td></tr></table></body></html>
`;
}

await mkdir(output, { recursive: true });
for (const message of messages) await writeFile(join(output, message.file), render(message));
