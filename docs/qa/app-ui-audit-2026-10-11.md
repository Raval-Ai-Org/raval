# Mellox app UI audit — 11 October 2026

Scope: app UI, including chat, Studio, Library, Brain, brand style, strategy, Autopilot, Audience, Analytics, Calendar, connections, Memory, links, projects, billing UI, authentication screens, workspace navigation and dialogs. Landing page excluded.

## Coverage

- Chromium on Windows, light and dark themes.
- General app: 320×568, 390×844, 667×375, 768×1024, 1024×768, 1440×900 and 1920×1080.
- Studio: 16 scenes covering brief, error, generation, multiple review formats, approved, scheduled, partial results and Library, at 390×844, 820×1180 and 1440×900.
- 224 general app screenshots and 96 Studio screenshots. Workspace screenshots additionally cover navigation and dialogs.
- Automated overflow and browser exception checks on each visual capture. WCAG 2 A/AA and 2.1 AA axe checks on general app surfaces at 390px and 1440px, and Studio at every tested size.
- Deterministic development fixtures and mocked network responses allow repeatable UI testing without using customer data or publishing content.

## Fixes

1. Removed the nested Supabase auth call from AccountMenu's auth listener, preventing session-lock stalls. Account identity updates directly from the session event.
2. Made chat startup greetings visible and adjusted short-screen positioning so landscape screens retain the heading and composer.
3. Routed the chat lab theme toggle through the shared theme hook.
4. Improved contrast for draft badges, project approval text, generation progress, Story preview chrome and carousel thumbnails.
5. Added accessible names for mobile Studio platform controls and valid roles for strategy frequency indicators and connector loading states.
6. Replaced Calendar's incomplete tab semantics with native segmented buttons using pressed state. Date selection, opening posts and adding posts are independent native controls.
7. Replaced Library's nested interactive card wrappers with separate native open/download controls. Download controls remain visible on touch devices.
8. Stabilized browser tests around hydration and cookie-based authentication; excluded Next's development overlay from workspace interaction tests.
9. Restored Studio chips' intended 44px mobile touch targets, which were being overridden by an unlayered global CSS rule. Desktop sizing remains compact.
10. Fixed Clarity startup: initialize its command queue before loading the remote tag, preventing the observed `undefined.v` browser exception. The bootstrap follows [Microsoft's setup example](https://clarity.microsoft.com/blog/microsoft-clarity-adds-support-for-custom-trusted-types-policies/). A mocked-tag browser regression verifies initialization order without sending analytics data.

## Verification

- General app visual audit: 224 captures, zero reported overflow, browser exception or accessibility issues.
- Studio visual audit: 96 captures, zero reported overflow, browser exception or accessibility issues.
- Focused unit tests: 58 passed across six files.
- TypeScript: passed.
- Changed-file lint: zero errors; existing warnings remain.
- Browser interaction regressions: 89 unique checks passed after fixes and reruns. The initial 84-case run passed 73; all 11 failed cases passed on rerun. Four additional Calendar checks and one analytics-bootstrap check passed. Both workspace theme checks were also rerun after the analytics change and passed.
- Some first-pass failures came from fixture readiness, development-overlay interception, inline SVG download restrictions and the local server exiting. These were isolated from product fixes and rerun. Library's SVG download test bypasses CSP only for fixture assets; production CSP is unchanged.
- Authentication screenshots use reduced motion to assess settled colours: one transient contrast flag arose while the decorative illustration was fading between scenes.

## Reproduce

Start the local app on port 8080, then run:

```powershell
node scripts/audit-app-ui.mjs
node scripts/audit-studio-ui.mjs
node node_modules/@playwright/test/cli.js test --project=integration tests/integration/app-ui-audit.spec.ts tests/integration/brain-lab.spec.ts tests/integration/audience-lab.spec.ts tests/integration/autopilot-lab.spec.ts tests/integration/memory-lab.spec.ts tests/integration/upgrade-lab.spec.ts tests/integration/tour-lab.spec.ts tests/integration/chat-mobile-flow.spec.ts tests/integration/create-mobile-flow.spec.ts tests/integration/modal-mobile-flow.spec.ts tests/integration/studio-mobile-flow.spec.ts tests/integration/library-keyboard-flow.spec.ts tests/integration/calendar-controls.spec.ts tests/integration/analytics-bootstrap.spec.ts --workers=1 --timeout=90000
node scripts/report-app-ui.mjs
node scripts/serve-ui-audit.mjs
```

Screenshots and the filterable gallery are generated under `.tmp-run/ui-audit/`. Machine-readable visual results are under `screens/results.json` and `studio/results.json`.

## Limits

This is a local UI regression audit, not proof of every possible user situation. Live OAuth, payments, external AI generation, real publishing, provider outages and production account permissions were not exercised. Firefox, Safari/WebKit and physical devices were not tested. Automated accessibility checks complement visual and keyboard review; they do not constitute a complete accessibility certification.
