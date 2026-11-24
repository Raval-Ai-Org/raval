---
name: video-for-services
description: How Mellox Studio makes videos for service businesses (trades, agencies, clinics, venues) instead of product-only videos. Use when a service brand gets a "product only, no people" video, when tuning video kinds for services, or when the video skill pack is benchmarked.
---

# Video for services (Round 9, pack `video`)

Decision record: `docs/adr/0053-creative-skill-packs.md`. Off unless
`FEATURE_FLAG_SKILLS_VIDEO_ENABLED=true`.

- **Is it a service?** `src/server/studio/business-kind.server.ts` reads the
  sector kind (service, venue or digital) once. It returns false when the pack
  is off.
- **What a service gets.** `KindSource.service` in `src/lib/studio/video/kinds.ts`:
  - a service with no product never gets `product-motion`,
    `product-showcase` or `product-demo` (`PRODUCT_ONLY`);
  - it gets `how-it-works`, the work shown being done with hands.
- **Same everywhere.** The clip count, model and price tier stay the same.
  `settleVideoControls` gets `service` at every call site, so the quote and
  the server agree. `service-kinds.test.ts` checks this.
- **No new kind ids.** None were added this round, and the ids are stored.
- **Researched arcs** (`docs/studio/research-2026-11/sales-and-video.md`) are
  for storyboard work only. Proof is a beat only when stored facts hold proof.
