# Mellox AI Supabase Auth emails

These HTML files are ready to paste into **Supabase Dashboard → Authentication → Email Templates**. Each file is a complete email body; paste its contents into the matching template and set the subject shown below. The files are generated from `scripts/supabase-auth-templates.mjs`. Commit changes to that script and regenerate with `node scripts/supabase-auth-templates.mjs` if you edit the design.

## Design and local review

All six templates reinterpret the landing page in a light theme: warm off-white canvas (`#F6F7F2`), white cards, dark slate text (`#243037`), and Mellox’s lime (`#CBE960`), purple (`#B489D1`), orange (`#FE7032`), and blue (`#0756E7`) accents. The pastel aurora hero, rounded pill, four-color rule, circular artwork, and softly tinted note cards are adapted from `hero-background.css`, `brains.css`, and `intro.css`. Dark green headline accents and deeper purple/orange label colors keep text readable on light surfaces. Light color-scheme metadata communicates the intended appearance to supporting email clients. The shared 600px layout includes a real brand-kit PNG logo, an early action button or verification code, three flow-specific next steps, security guidance, and support links. Action emails also include a copyable fallback URL.

Typography matches the landing page layout: **Google Sans Flex** for copy and headlines, **Michroma** for the wordmark, and **Micro 5** for decorative note labels. A Google Fonts stylesheet loads these fonts where supported. Inline system-font fallbacks and an Outlook-specific Arial override preserve readability when web fonts are blocked. Gradients and shadows also have solid-color fallbacks.

The decorative artwork gently floats and turns for two cycles in clients that support CSS animation. Reduced-motion preferences disable it. Clients that remove animation or head styles receive the complete static design with inline styling; authentication never depends on motion, images, JavaScript, or external stylesheets. The emails use presentation tables, Outlook width/DPI fallbacks, solid background colors, and a mobile breakpoint. Actual inbox rendering can vary, especially classic Outlook rounding and automatic dark-mode recoloring.

Generate and review entirely locally:

```sh
node scripts/supabase-auth-templates.mjs
npx vitest run tests/unit/email-confirmation.test.ts
node scripts/preview-auth-emails.mjs
node scripts/preview-auth-emails.mjs --fonts
node scripts/preview-auth-emails.mjs --fonts --check-only
```

The preview command requires the repository’s Playwright Chromium browser. It creates an ignored `.tmp-run/auth-email-previews/index.html` gallery, six example-token HTML previews, and mobile/desktop screenshots. It checks all six templates at 320, 375, 600, and 900px, blocked-image/style-stripped fallbacks, reduced motion, button touch targets, logo rendering, and HTML size. The default run blocks web fonts to check fallback layouts. `--fonts` downloads the three actual Latin font faces from Google Fonts, verifies they load in every template, and checks the same widths with those fonts. It does not send mail, click authentication links, or contact Supabase. Preview tokens are dummy values; use the files in this directory for the actual templates.

Use `--check-only` to run layout, text contrast, font, and fallback checks without writing preview artifacts. Text is checked for a minimum 4.5:1 contrast ratio against its solid background fallback.

Neither script deploys the app or updates Supabase. Apply and verify Dashboard settings separately; the complete incident rollout and validation checklist is in [ROLLOUT-2026-10-21.md](./ROLLOUT-2026-10-21.md).

| Dashboard template   | HTML file               | Subject                             |
| -------------------- | ----------------------- | ----------------------------------- |
| Confirm signup       | `confirmation.html`     | Confirm your Mellox AI email        |
| Reset password       | `recovery.html`         | Reset your Mellox AI password       |
| Invite user          | `invite.html`           | You’re invited to Mellox AI         |
| Magic link           | `magic-link.html`       | Your Mellox AI sign-in link         |
| Change email address | `email-change.html`     | Confirm your Mellox AI email change |
| Reauthentication     | `reauthentication.html` | Your Mellox AI verification code    |

## Dashboard settings

1. Set **Authentication → URL Configuration → Site URL** to `https://mellox.ai`. Keep the existing production and local **Additional Redirect URLs** needed for `/auth/callback` (Google OAuth and current signup) and `/reset-password` (existing recovery requests). The new email templates use the fixed `https://mellox.ai/auth/confirm` link, so they do not use `RedirectTo` as a destination.
2. Save each body and subject in **Authentication → Email Templates**. Send a test email for each enabled flow after the app code and `public/assets/mellox-email-mark.png` are on the production domain. The new confirmation page must be live before saving the templates.
3. Keep your current **Authentication → SMTP** settings and Resend sender. If Resend click tracking is enabled for auth mail, disable it so the one-time fragment link is delivered intact. No Resend API setting or code change is needed here.

The five action emails link to the production domain used throughout this codebase. Their token hash is in the URL fragment, which browsers do not send to the server. Preserve `{{ .TokenHash }}` exactly, including Supabase's `pkce_` prefix. The page removes it from browser history and waits for the recipient to press a button before calling `verifyOtp`. Ordinary GET/HEAD requests and JavaScript page loads never verify a token. The reauthentication email contains only Supabase’s `{{ .Token }}` code for the reauthentication prompt. The page accepts only fixed Supabase email OTP types (`email`, legacy `signup`, `recovery`, `invite`, `magiclink`, `email_change`) and redirects only to a safe stored path, `/projects`, or `/reset-password`; it does not trust an email-supplied redirect. Pending confirmation state is kept in tab-only sessionStorage for up to one hour so refresh/mobile suspension can resume; successful confirmation/navigation and sign-out clear it. Supabase remains authoritative about expiry and single use.

The PNG logo is copied unchanged from the existing Mellox brand kit. It is served by the app at `https://mellox.ai/assets/mellox-email-mark.png`; some clients block remote images by default, so the text wordmark remains visible.
