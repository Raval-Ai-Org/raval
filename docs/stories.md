# Stories

Mellox treats a Story as a `content_items` row with `kind = 'story'`. Studio creates 9:16 frames or reuses an existing vertical video. A sequence is one content item, with its frames stored in order. The existing approval, calendar, publishing, usage, and Autopilot systems handle it; there is no separate Story queue.

## Availability and provider limits

Stories publish through Post for Me to connected Instagram and Facebook accounts. Each media item in a Story sequence becomes a separate provider Story and counts toward the provider's post limits. The publish adapter sets `placement: "stories"` in the platform configuration, uses account media overrides when retrying failed frames, and records each provider result in `content_publications.frames`. Video can be reused between a Story and a Reel when the stored asset belongs to the same workspace.

The editor offers image and video frames, captions, Instagram media tags, scheduling, and multi-account publishing. Native music, link, poll, question, and location stickers are unavailable through this integration. The editor describes visible-text or reply-based alternatives without presenting them as native stickers. Thumbnail support depends on the destination platform and media type.

## Autopilot

Story Autopilot uses the existing program and action leases. A workspace can select days, one to four Stories per day, posting window, Instagram and/or Facebook, themes, one to five frames, and timing based on its measured Story reach. The weekly plan rotates themes and generates the content ahead of the planned time. Existing approval rules still apply. Stories that miss their approval window are not sent as stale content.

## Analytics and recovery

Post for Me results and webhooks advance publication status. The reconciliation worker retries unresolved status checks and samples available Story feed metrics hourly while a Story is live, preserving the last available snapshot. Feed metrics require the `feeds` permission when connecting an account; older connections may need reconnection. Missing network metrics are shown as unavailable rather than estimated. Failed frames are tracked separately so recovery does not resend successful frames. A retry is refused if the source media changed after the first send. Results without a trustworthy frame identifier remain unresolved rather than being assigned to a frame by guesswork.

## Rollout

Apply `supabase/migrations/20261006090000_stories.sql` before enabling the feature in a deployed environment. `FEATURE_FLAG_STORIES_ENABLED=false` disables new Story creation and publishing globally; `FEATURE_FLAG_STORIES_ENABLED_WS_<workspace UUID>` overrides it for one workspace. Keep the existing schedule and reconciliation jobs running. Verify an Instagram and a Facebook account with `posts` and `feeds` permission, then publish one image Story, one multi-frame sequence, and one video Story and confirm their individual results and metrics.

Provider references: [Stories](https://www.postforme.dev/resources/posting-instagram-and-facebook-stories), [placement and account overrides](https://www.postforme.dev/resources/posting-reels-and-stories), [feed metrics](https://www.postforme.dev/resources/getting-post-analytics), and [webhooks](https://www.postforme.dev/resources/real-time-updates-with-webhooks).
