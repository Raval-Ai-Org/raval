# Mellox AI Supabase Auth emails

These HTML files are ready to paste into **Supabase Dashboard → Authentication → Email Templates**. Each file is a complete email body; paste its contents into the matching template and set the subject shown below. The files are generated from `scripts/supabase-auth-templates.mjs`. Commit changes to that script and regenerate with `node scripts/supabase-auth-templates.mjs` if you edit the design.

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

The five action emails link to the production domain used throughout this codebase. Their token hash is in the URL fragment, which browsers do not send to the server. The page removes it from browser history and waits for the recipient to press a button before calling `verifyOtp`. This prevents ordinary email link prefetchers from consuming the token. The reauthentication email contains only Supabase’s `{{ .Token }}` code for the reauthentication prompt. The page accepts only the five fixed Supabase email OTP types and redirects only to a safe stored workspace path, `/projects`, or `/reset-password`; it does not trust an email-supplied redirect.

The PNG logo is copied unchanged from the existing Mellox brand kit. It is served by the app at `https://mellox.ai/assets/mellox-email-mark.png`; some clients block remote images by default, so the text wordmark remains visible.
