Read `docs/pricing/v2/IMPLEMENTATION_BRIEF.md` from start to finish, then `CLAUDE.md`. That brief is the full spec for Mellox's new billing system: credits that belong to the user's billing account (not a workspace), five plans, separate Video Credits so video can never drain the plan, Pro and Flash chat allowances, social publishing limited by connected SocialAPI profiles (not posts), KIE for Veo and Grok video with OpenRouter for the rest, locked-but-visible features with an upgrade flow, Paddle billing, lifecycle, admin, monitoring and tests. The pricing catalog is `docs/pricing/v2/catalog.reference.ts.txt` and the cost model behind it is `docs/pricing/v2/Mellox_AI_Pricing_Model_v2.xlsx`.

You have full permission to change this codebase to ship it. Work on a new branch `feat/billing-v2`.

1. Start in plan mode. Use subagents to map the code the brief lists in section 0, then write `docs/billing/PLAN.md` and the ADR.
2. Then carry out phases 1 to 9 from section 17 in order, without stopping for my approval between phases. End each phase with typecheck, lint, tests, build and `db:verify` green, and commit it.
3. Stop and ask me only for items marked ASK ZAIN, before merging to `main` (it auto-deploys), and before anything irreversible against the production database or Paddle production.
4. Never read, print or commit values from `.env` or `.env.local`. Add new variable names to `.env.example` with placeholders only.
5. If the brief and the code disagree, follow the code's reality, keep the intent, and record the change in the ADR.

When everything is done, give me the final report described in section 19 of the brief, including the checklist of things only I can do.
