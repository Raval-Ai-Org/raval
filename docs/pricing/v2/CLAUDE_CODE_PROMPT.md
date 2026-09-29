I'm the founder of Mellox AI. Build a complete, working plans, credits and billing system in this codebase and take it to a launch-ready state. You have full permission to change the code. Work on your own from start to finish and make the best decisions for the product. Don't stop to ask for approval between steps.

The source of truth for every price, allowance, limit and cost is my financial model, `docs/pricing/v2/Mellox_AI_Pricing_Model_v2.xlsx`. Use its Plans, Feature Matrix, Credit Menu, Video Credits and Add-ons & Packs tabs. `docs/pricing/v2/catalog.reference.ts.txt` holds the same numbers as code, and `docs/pricing/v2/IMPLEMENTATION_BRIEF.md` has detailed notes and edge cases. Use both as references, not as a script to follow line by line. Don't invent numbers.

**Important: an earlier Codex session already changed billing-related code in this repo, and it did not do it right.** Treat that work as unreviewed. Find it with `git status`, `git log` and `git diff`, judge each piece honestly, and keep what is solid, fix what is close, and cleanly remove what is wrong or half-built. Never build on top of broken code just because it exists.

**What the product must do**
- **Credits belong to the user, not the workspace.** One owner has one balance, shared across all their brands. Teammates spend the owner's balance inside the owner's brands. Only the owner can buy or change the plan; teammates can send the owner an upgrade request.
- **Plans:** Free, Starter $49, Growth $149, Agency $449 and Scale $1,199, exactly as in the Excel. Annual billing is 2 months free.
- **Separate balances so nothing drains everything:**
  - Credits for AI work, priced per action.
  - Video credits for video only; normal credits can never buy video.
  - A monthly allowance of Pro chat messages.
  - A fair-use cap on Flash chat.
- **Social publishing now runs on the Post for Me API** (`postforme.dev`, $10 for 1,000 posts, unlimited social accounts). It replaces SocialAPI.ai; keep SocialAPI only as a legacy adapter until existing connections are moved.
  - Posts are **unlimited on every plan, including Free**, and publishing, scheduling and retries **never use credits**. Generating post content with AI still costs credits as normal.
  - There is no post or account limit to sell. Protect against spam with a hidden fair-use cap per account (from the Excel), a rate limit, and a verified email before the first publish.
- **Video:** KIE runs Veo 3.1 Fast/Lite and Grok Imagine for now. OpenRouter runs the other video models and is the fallback. A fallback must never cost more than we charge for that video.
- **Locked features stay visible.** On a lower plan the user sees every feature with a small lock. Clicking it opens a clean upgrade screen: what the feature does, which plan unlocks it, the price, and one-click upgrade. The server enforces the same rules.
- **Every paid button shows its cost.** Charge only on success, and refund automatically on failure.
- **One billing page:** plan, balances, usage, history, upgrade and downgrade, credit and video packs, cancel.
- **Payments through Paddle.** Stripe can't onboard my Pakistani company. Make it work in Paddle sandbox, with a switch to turn enforcement off or into log-only mode for safe testing.

**How to work**
1. **Read `CLAUDE.md` first and follow it; it is enforced.** Then study the real code for workspaces, AI metering and budgets, the credit ledger, plans, Stripe, social distribution, UGC video and the UI components. Then audit the Codex changes.
2. **Make your own plan from what you actually find,** then build in priority order. The core money flow comes first:
   - account balance
   - charging
   - feature gates
   - upgrade screen and billing page
   - Post for Me publishing
   - Paddle

   Extras come after the core works end to end. Reuse existing code wherever it fits. Don't refactor unrelated code or spend effort on polish before the core works.
3. **UI/UX must be excellent and consistent.** Use the existing design system and components from `CLAUDE.md` (modal shell, tokens, icons, empty/error states). Run the app and check every screen you build. No placeholders or half-wired buttons.
4. **Verify honestly.** Run typecheck, lint, tests and build for what you changed, and add tests for the money logic. If something can't run (network, database, Paddle or Post for Me sandbox), say exactly what was skipped. Never claim something works if you didn't check it.
5. **Safety:**
   - Work on a new branch; never push or merge to `main` (it auto-deploys).
   - Never read, print or commit values from `.env` files. Only add variable names with placeholders to `.env.example`.
   - Apply migrations only locally or on staging.
   - Don't break the existing backlink credits flow; move it onto the new account-level balance.
6. **Leave a trail.** Commit after each working piece. Keep `docs/billing/PROGRESS.md` updated with what's done, what's next, what you kept or removed from the Codex work, and why. If you run out of context, stop at a clean point and update that file. When this prompt is given again, read `PROGRESS.md` and `git log` first and continue from there.

When you finish, give me a short report: what you built, what you kept/fixed/removed from the earlier attempt, how to test it, what couldn't be verified, which environment variables and Paddle / Post for Me setup I need, and anything I still have to do myself.
