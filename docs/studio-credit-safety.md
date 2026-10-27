# Studio credit safety

Studio suggestions are included in the subscription. Opening Studio, refreshing its suggestions, saving an upload and viewing a draft do not reserve or spend credits. Suggestions still use the gateway's provider budgets, rate limits and a shared cache; saving content filters already-used ideas without invalidating the cache on every draft.

Explicit writing and generation actions show their price before starting. Caption improvements reuse the saved media and cost the existing four-credit text revision price. Keeping a supplied photo uses the copy price instead of the image-generation bundle. Editing or generating new images and rendering video retain their quoted media prices. Saved carousel and Story artwork changes use an explicitly priced Update visuals action; approval cannot silently trigger the rebuild. When an optional image fails but the social copy succeeds, only the copy price is captured.

Every newly created Studio job, including an inline script or caption job, links its reservation before provider work starts. Success, failure, cancellation, polling and background settlement share the same idempotent settlement path. A lost browser response retains its request key, so retrying cannot authorize a second charge for that request.

The balance distinguishes available credits from reservations. Billing activity includes the time, action, linked Studio job title, reservations, charges and returned reservations. Pending Studio jobs can be stopped from the content pipeline or billing view. Pausing Autopilot stops its pending Studio generations and releases their unused reservations; posts already scheduled remain scheduled. A provider request already in flight may finish, but a cancelled job cannot be revived or start another paid generation step.

An inline request stranded without pending media work is failed after 15 minutes without stage progress. Jobs also have an absolute two-hour lifetime. Both the billing worker and the Studio job-list recovery path settle recovered jobs, including jobs left by an interrupted deployment. The regular billing cron must be healthy for recovery while nobody has the app open.

Uploaded photos can be selected from Library or uploaded directly in Studio. The server verifies each asset belongs to the job's workspace before signing it or reserving credits. Caption generation receives the actual photo through vision input. Uploading and selecting photos are free. A completed script has a Make video action that opens a new video brief with the script, source item and duration; the person reviews the settings and price before generating.

## Existing customer incident

This change does not automatically refund historical captures. Before adjusting a customer's balance, reconcile `meter_ledger` and `meter_holds` for their billing account against `billing_studio_jobs`, `studio_jobs` and `ai_usage_events` for the reported period. Separate captured charges from open reservations, check who initiated each job, and identify suggestion charges or duplicate/unrequested work. Use the existing admin credit-adjustment flow for verified restitution, with the incident and original transaction IDs recorded. Do not edit immutable ledger rows or refund the same transaction twice.

After deployment, verify the billing cron heartbeat, inspect the affected account's pending work, and confirm that cancelled/stale jobs have returned their unused holds. No production data, customer refunds or subscription prices are changed by checking out this code.
