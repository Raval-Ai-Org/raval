// Local-only generator. Never connects to Supabase or changes live settings.
// Preserve the fragment-based confirmation route and Supabase Go expressions.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const output = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "email-templates");
const base = "https://mellox.ai/auth/confirm#token_hash={{ .TokenHash }}&amp;type=";
const logo = "https://mellox.ai/assets/mellox-email-mark.png";
const messages = [
  {
    file: "confirmation.html",
    type: "email",
    eyebrow: "A LITTLE HELLO. A BIG BEGINNING.",
    heading: "Great ideas start<br>with a little hello.",
    title: "Confirm your email",
    body: "Welcome to Mellox AI. Your next chapter in marketing starts here. Confirm your email to finish setting up your account and take the first step into your workspace.",
    button: "Confirm my email",
    caption: "One small click. A fresh start for your brand.",
    symbol: "✳",
    accent: "#CBE960",
    stamp: "LET’S GET STARTED",
    section: "Your first steps with Mellox",
    steps: [
      ["Make it official", "Confirm your email using the button above."],
      ["Meet your workspace", "Continue into Mellox and complete your account setup."],
      [
        "Bring your brand",
        "Start with your brand context, then explore ideas, content, and insights.",
      ],
    ],
    tipTitle: "Built around your brand",
    tip: "From the first idea to the next campaign, Mellox brings your marketing thinking and creative work into one place. Start with what makes your brand yours.",
    note: "If you didn’t create a Mellox AI account, you can ignore this email. No action is needed.",
  },
  {
    file: "recovery.html",
    type: "recovery",
    eyebrow: "A FRESH START, JUST FOR YOU.",
    heading: "New password.<br>Same big ideas.",
    title: "Reset your password",
    body: "Forgot your password? It happens. We received a request to reset the password for your Mellox AI account. Use the button below to choose a new one and get back to your workspace.",
    button: "Reset my password",
    caption: "Your password stays the same until you change it.",
    symbol: "↻",
    accent: "#B489D1",
    stamp: "FRESH START",
    section: "Back in, in a few simple steps",
    steps: [
      ["Open your reset link", "Use the button above to continue to Mellox’s confirmation page."],
      ["Choose a new password", "Confirm the request, then set a strong, unique password."],
      ["Pick up where you left off", "Sign in again and return to your marketing workspace."],
    ],
    tipTitle: "A little security goes a long way",
    tip: "Choose a password you don’t use anywhere else. A password manager can help you create and keep a strong one. Never share this reset link.",
    note: "If you didn’t request a password reset, ignore this email. Your password has not changed. If you’re concerned about your account, contact our support team.",
  },
  {
    file: "invite.html",
    type: "invite",
    eyebrow: "GOOD IDEAS LOVE GOOD COMPANY.",
    heading: "There’s a place<br>for you here.",
    title: "Your invitation to Mellox AI",
    body: "You’ve been invited to Mellox AI. Bring your perspective, your next big idea, and a little curiosity. Accept your invitation to continue into your workspace.",
    button: "Accept my invitation",
    caption: "Your next creative chapter is one click closer.",
    symbol: "+",
    accent: "#FE7032",
    stamp: "YOU’RE INVITED",
    section: "Make yourself at home",
    steps: [
      ["Accept your invitation", "Use the button above to confirm your invitation to Mellox."],
      ["Get settled in", "Follow the account setup prompts shown in your workspace."],
      [
        "Create something together",
        "Explore your workspace and bring your ideas into the conversation.",
      ],
    ],
    tipTitle: "More perspectives. Better possibilities.",
    tip: "Mellox is a place to connect brand thinking with creative action. Share context, explore possibilities, and keep your marketing work moving together.",
    note: "If you weren’t expecting this invitation, you can ignore it. Only accept invitations you recognize. Contact support if you need help checking the request.",
  },
  {
    file: "magic-link.html",
    type: "magiclink",
    eyebrow: "LESS FRICTION. MORE MOMENTUM.",
    heading: "A little link.<br>A lot of possibility.",
    title: "Your sign-in link",
    body: "Your Mellox AI sign-in link is ready. No password to remember for this sign-in: just follow the link, confirm it’s you, and get back to the ideas waiting in your workspace.",
    button: "Sign in to Mellox",
    caption: "One-time access. Made for your next move.",
    symbol: "↗",
    accent: "#CBE960",
    stamp: "WELCOME BACK",
    section: "Your shortcut back to work",
    steps: [
      ["Follow your sign-in link", "Use the button above on the device where you want to sign in."],
      ["Confirm it’s you", "Continue on Mellox’s confirmation page to complete sign-in."],
      ["Find your flow", "Return to your workspace and pick up your next task."],
    ],
    tipTitle: "This link is just for you",
    tip: "Treat this sign-in link like a password. Don’t forward it or share it. If it has expired or has already been used, request a fresh link from the sign-in page.",
    note: "If you didn’t ask to sign in, you can ignore this email. Don’t share this link with anyone, including someone claiming to be support.",
  },
  {
    file: "email-change.html",
    type: "email_change",
    eyebrow: "NEW ADDRESS. SAME CREATIVE ENERGY.",
    heading: "New inbox.<br>Same creative spark.",
    title: "Confirm your email change",
    body: "We received a request to change the email address on your Mellox AI account. Confirm this request below to continue the update and keep your account details in sync.",
    button: "Confirm email change",
    caption: "Only continue if you requested this change.",
    symbol: "↔",
    accent: "#B489D1",
    stamp: "STAY CONNECTED",
    section: "Let’s keep your account connected",
    steps: [
      ["Review the request", "Make sure you initiated this email address change."],
      [
        "Confirm the update",
        "Use the button above. You may need to confirm from both your old and new inboxes.",
      ],
      [
        "Keep an eye on both inboxes",
        "Complete any remaining confirmation before using your new address to sign in.",
      ],
    ],
    tipTitle: "Two inboxes, one careful check",
    tip: "Depending on your account’s security settings, confirmation may be required from both addresses. Follow the confirmation email in each inbox to finish the change.",
    note: "If you didn’t request this change, do not confirm it. Sign in to Mellox directly to review your account settings and contact support if you need help.",
  },
  {
    file: "reauthentication.html",
    type: null,
    eyebrow: "A LITTLE CHECK. EXTRA PEACE OF MIND.",
    heading: "Big moves.<br>One quick check.",
    title: "Your verification code",
    body: "Some account actions need an extra check. Enter this one-time verification code in Mellox AI to confirm it’s you and continue the sensitive action you started.",
    caption: "Enter this code in the verification prompt in Mellox.",
    symbol: "#",
    accent: "#CBE960",
    stamp: "JUST FOR YOU",
    section: "Finish your security check",
    steps: [
      ["Return to Mellox", "Go back to the verification prompt where you started the action."],
      ["Enter your code", "Copy the code above into the prompt to confirm it’s you."],
      [
        "Continue with confidence",
        "Once verified, follow the instructions to complete your action.",
      ],
    ],
    tipTitle: "Keep your code to yourself",
    tip: "This code is for your verification prompt only. Never send it to another person. If it expires or doesn’t work, request a new code in Mellox.",
    note: "If you didn’t request this code, ignore this email and don’t share the code. If you’re concerned about your account, contact our support team.",
  },
];

function render(message) {
  const url = message.type ? `${base}${message.type}` : null;
  const accentInk =
    message.accent === "#B489D1" ? "#694785" : message.accent === "#FE7032" ? "#9C431C" : "#40531B";
  const heading =
    message.heading.replace("<br>", '<br><span class="headline-accent" style="color:#40531B;">') +
    "</span>";
  // A table-backed padded anchor remains usable when a client strips the CSS.
  const action = url
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#CBE960" style="background:#CBE960;border-radius:999px;box-shadow:0 6px 16px -8px rgba(64,83,27,0.24);mso-padding-alt:18px 24px;"><a class="cta" href="${url}" style="display:block;padding:18px 24px;border:1px solid #CBE960;border-radius:999px;color:#172025;font-size:16px;font-weight:700;line-height:24px;text-align:center;text-decoration:none;">${message.button} &nbsp; →</a></td></tr></table>`
    : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#F3F6EA" style="padding:24px 12px;background:#F3F6EA;border:1px solid #D5DFC7;border-radius:14px;"><p style="margin:0 0 12px;color:#59656D;font-size:11px;line-height:18px;letter-spacing:2px;">YOUR ONE-TIME CODE</p><p class="code" style="margin:0;color:#40531B;font-family:Consolas,Menlo,monospace;font-size:32px;font-weight:700;line-height:42px;letter-spacing:6px;overflow-wrap:anywhere;">{{ .Token }}</p></td></tr></table>`;
  const steps = message.steps
    .map(
      ([title, text], index) =>
        `<tr><td width="44" valign="top" style="width:44px;padding:0 0 24px;"><table role="presentation" width="32" cellspacing="0" cellpadding="0" border="0"><tr><td height="32" align="center" bgcolor="#EDF3DC" style="height:32px;background:#EDF3DC;border-radius:999px;color:#40531B;font-size:12px;line-height:32px;font-weight:700;">0${index + 1}</td></tr></table></td><td valign="top" style="padding:0 0 24px;"><h3 style="margin:0 0 6px;color:#243037;font-size:16px;line-height:23px;">${title}</h3><p style="margin:0;color:#59656D;font-size:14px;line-height:23px;">${text}</p></td></tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<title>${message.title} · Mellox AI</title>
<!--[if !mso]><!--><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@8..144,100..1000&amp;family=Michroma:wght@400&amp;family=Micro+5:wght@400&amp;display=swap"><!--<![endif]-->
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><style>body,table,td,a,p,h1,h2,h3{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
<style>
body{margin:0;padding:0}body,table,td,a,p,h1,h2,h3{font-family:'Google Sans Flex','Segoe UI',Arial,Helvetica,sans-serif}table{border-collapse:separate;mso-table-lspace:0pt;mso-table-rspace:0pt}a{color:#40531B}a:focus-visible{outline:3px solid #B489D1;outline-offset:4px}
.wordmark{font-family:'Michroma','Segoe UI',Arial,sans-serif!important}.micro-label{font-family:'Micro 5',Consolas,monospace!important}
.headline-accent{color:#40531B!important}
@keyframes mellox-float{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-6px) rotate(5deg)}}
@keyframes mellox-spark{0%,100%{transform:rotate(0deg)}50%{transform:rotate(22deg)}}
.motif{animation:mellox-float 3s ease-in-out 2}.spark{animation:mellox-spark 3s ease-in-out 2}
@media(prefers-reduced-motion:reduce){.motif,.spark{animation:none!important;transform:none!important}}
@media only screen and (max-width:620px){.outer{padding:24px 12px!important}.inner{padding-left:24px!important;padding-right:24px!important}.heading{font-size:32px!important;line-height:37px!important;letter-spacing:-1px!important}.hero{padding-top:28px!important;padding-bottom:28px!important}.motif{font-size:64px!important;line-height:80px!important}.code{font-size:27px!important;letter-spacing:4px!important}.footer{padding:24px 12px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:#F6F7F2;color:#243037;font-family:'Google Sans Flex','Segoe UI',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${message.title}. ${message.caption}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F6F7F2" style="width:100%;background:#F6F7F2;"><tr><td class="outer" align="center" style="padding:48px 16px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
<tr><td class="inner" style="padding:0 40px 28px;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td width="56" valign="middle" style="width:56px;"><a href="https://mellox.ai" style="text-decoration:none;"><img src="${logo}" width="44" height="44" alt="Mellox logo" style="display:block;width:44px;height:44px;border:0;border-radius:12px;color:#40531B;font-size:10px;"></a></td><td class="wordmark" valign="middle" style="color:#243037;font-family:'Michroma','Segoe UI',Arial,sans-serif;font-size:18px;line-height:28px;font-weight:400;letter-spacing:-0.4px;">Mellox <span style="color:#40531B;">AI</span><br><span style="font-family:'Google Sans Flex','Segoe UI',Arial,sans-serif;font-size:9px;line-height:16px;font-weight:400;letter-spacing:1.2px;color:#59656D;">MARKETING INTELLIGENCE LAYER</span></td></tr></table>
</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #E0E6DC;border-radius:24px;box-shadow:0 16px 48px -24px rgba(36,48,55,0.18);">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td class="inner hero" bgcolor="#F4F7EC" style="padding:28px 40px;background-color:#F4F7EC;background-image:radial-gradient(ellipse at 50% 100%,rgba(203,233,96,0.28),transparent 70%),radial-gradient(ellipse at 10% 50%,rgba(180,137,209,0.16),transparent 60%),radial-gradient(ellipse at 90% 65%,rgba(7,86,231,0.08),transparent 60%);border-radius:24px 24px 0 0;border-bottom:1px solid #E0E6DC;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" aria-hidden="true"><tr><td width="25%" style="color:#B489D1;font-size:28px;line-height:36px;text-align:center;"><span class="spark" style="display:inline-block;">✦</span></td><td width="50%" align="center"><div class="motif" style="display:inline-block;width:88px;background:${message.accent};border-radius:999px;border:6px solid #FFFFFF;box-shadow:0 8px 24px -12px rgba(36,48,55,0.20);color:#172025;font-family:Arial,Helvetica,sans-serif;font-size:60px;font-weight:700;line-height:88px;text-align:center;">${message.symbol}</div></td><td width="25%" style="color:#789AFF;font-size:28px;line-height:36px;text-align:center;"><span class="spark" style="display:inline-block;">✦</span></td></tr></table>
<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" style="margin:20px auto 0;"><tr><td bgcolor="#FFFFFF" style="padding:8px 16px;background:#FFFFFF;border:1px solid #D8E0D0;border-radius:999px;color:#243037;font-size:11px;line-height:18px;letter-spacing:0.4px;text-align:center;">${message.stamp} &nbsp; · &nbsp; MELLOX AI</td></tr></table>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" aria-hidden="true" style="margin:28px 0 0;"><tr><td width="25%" height="2" bgcolor="#B489D1" style="height:2px;background:#B489D1;"></td><td width="25%" height="2" bgcolor="#FE7032" style="height:2px;background:#FE7032;"></td><td width="25%" height="2" bgcolor="#0756E7" style="height:2px;background:#0756E7;"></td><td width="25%" height="2" bgcolor="#CBE960" style="height:2px;background:#CBE960;"></td></tr></table>
</td></tr>
<tr><td class="inner" style="padding:40px 40px 32px;">
<p style="margin:0 0 16px;color:#40531B;font-size:10px;font-weight:700;letter-spacing:1.8px;line-height:18px;">${message.eyebrow}</p>
<h1 class="heading" style="margin:0;color:#243037;font-size:40px;font-weight:600;letter-spacing:-1.5px;line-height:46px;">${heading}</h1>
<p style="margin:20px 0 28px;color:#59656D;font-size:16px;line-height:27px;">${message.body}</p>
${action}
<p style="margin:14px 0 0;color:#647079;font-size:12px;line-height:20px;text-align:center;">${message.caption}</p>
</td></tr>
<tr><td class="inner" style="padding:0 40px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-top:1px solid #E0E6DC;padding:28px 0 24px;"><h2 style="margin:0;color:#243037;font-size:20px;font-weight:700;line-height:28px;letter-spacing:-0.3px;">${message.section}</h2></td></tr></table><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${steps}</table></td></tr>
<tr><td class="inner" style="padding:0 40px 28px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td bgcolor="#F4F6F1" style="padding:24px;background-color:#F4F6F1;background-image:linear-gradient(135deg,rgba(180,137,209,0.06),transparent 55%,rgba(203,233,96,0.10));border:1px solid #DCE4D7;border-left:3px solid ${message.accent};border-radius:16px;"><p class="micro-label" style="margin:0 0 10px;color:${accentInk};font-family:'Micro 5',Consolas,monospace;font-size:21px;line-height:24px;font-weight:400;letter-spacing:1px;">A LITTLE MELLOX NOTE</p><h2 style="margin:0 0 10px;color:#243037;font-size:18px;line-height:25px;">${message.tipTitle}</h2><p style="margin:0;color:#4F5C65;font-size:14px;line-height:24px;">${message.tip}</p></td></tr></table></td></tr>
<tr><td class="inner" style="padding:0 40px 32px;">
${url ? `<p style="margin:0 0 10px;color:#243037;font-size:13px;line-height:21px;font-weight:700;">Button taking a break?</p><p style="margin:0 0 24px;color:#59656D;font-size:12px;line-height:21px;">Copy and paste this link into your browser:<br><a href="${url}" style="color:#40531B;text-decoration:underline;word-break:break-all;overflow-wrap:anywhere;">${url}</a></p>` : ""}
<p style="margin:0;padding-top:20px;border-top:1px solid #E0E6DC;color:#59656D;font-size:13px;line-height:22px;"><strong style="color:#243037;">Wasn’t you?</strong><br>${message.note}</p>
</td></tr>
</table></td></tr>
<tr><td class="footer" align="center" style="padding:28px 24px 0;"><p style="margin:0 0 8px;color:#40531B;font-size:15px;font-weight:700;line-height:24px;">A little spark for your next big thing.</p><p style="margin:0 0 18px;color:#647079;font-size:12px;line-height:20px;">Mellox AI · Marketing Intelligence Layer<br>This is an account email from Mellox AI.</p><p style="margin:0;color:#59656D;font-size:12px;line-height:24px;"><a href="https://mellox.ai/contact" style="color:#4F5C65;text-decoration:underline;">Get help</a> &nbsp; · &nbsp; <a href="https://mellox.ai/security" style="color:#4F5C65;text-decoration:underline;">Security</a> &nbsp; · &nbsp; <a href="https://mellox.ai/privacy" style="color:#4F5C65;text-decoration:underline;">Privacy</a></p><p style="margin:12px 0 0;color:#647079;font-size:12px;line-height:20px;">Need a hand? <a href="mailto:support@mellox.ai" style="color:#4F5C65;text-decoration:underline;">support@mellox.ai</a></p></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>
`;
}

await mkdir(output, { recursive: true });
for (const message of messages) await writeFile(join(output, message.file), render(message));
