# Troubleshooting

| Symptom | First checks |
| --- | --- |
| Login loops or silent submit | Run `npm run setup`; check placeholder/missing Supabase env; restart dev server |
| Workspace data is empty | Verify the URL workspace id, membership, RLS, and workspace-scoped query key |
| AI request is rejected | Check route input, rate limit, budget status, provider key, and feature flag |
| Generation is degraded | Check `/api/health`, KIE/provider configuration, job lease state, and webhook/polling path |
| Publish remains pending | Check provider flag, target account ownership, webhook signature, then reconciliation hook |
| GEO finding does not close | Run verification; approval/proposal alone cannot resolve findings |
| Callback fails | Check allowed return origins, exact deployment URL, OAuth credentials, and server logs without secrets |
| Migration/type mismatch | Run `npm run db:verify`, then `npm run db:types`; inspect the newest migration |
| Stale UI | Invalidate the workspace query or use the existing `content:changed` event path; avoid localStorage tenant fallback |

## Troubleshooting mindset

For Mellox AI, the most useful diagnosis usually starts with the trust boundary,
not the UI. Confirm the request is authenticated, the workspace is valid, the
role is sufficient, and the server-side feature flag and provider configuration
match the intended runtime state. Most issues in this repo are caused by one of
those layers being out of sync rather than by a purely UI problem.

For incidents, follow [operations](operations.md). Never bypass authorization,
RLS, signature verification, budget checks, or SSRF protection as a diagnostic
shortcut.
