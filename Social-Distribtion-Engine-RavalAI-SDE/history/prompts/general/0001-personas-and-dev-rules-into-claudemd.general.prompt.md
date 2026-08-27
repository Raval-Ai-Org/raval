---
id: 0001
title: Personas and Dev Rules into CLAUDE.md
stage: general
date: 2026-07-26
surface: agent
model: claude-opus-4-8
feature: none
branch: master
user: nauman_sajjad
command: (conversational request)
labels: ["claude-md", "persona", "governance", "raval-ai", "onboarding"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - /home/nauman_sajjad/Desktop/Raval-AI/CLAUDE.md
tests:
 - none (documentation/governance change)
---

## Prompt

well i need you to give you a persona to be updated inside the claude.md first okay : go for see it okay and also the above one chats as well ; '/home/nauman_sajjad/Downloads/ravalai_assistant_persona_multidimensional.md'

well before moving further about this persona do se this persona please that i had make it ready , do analyse it and compare it against our existing now claude.md stuff okay : '/home/nauman_sajjad/Downloads/RavalAI_Backend_Architect_Persona.md'

-- also go for adding these andrej karpathy's development rules as well explicitly as i am sharing you okay (25 Claude Development Rules, Rule 1 through Rule 25, verbatim).

now go for this all task okay and update or modify these persona to be the best for us and also if the persona that i send you above is better then use it as it is and also if it could be improved then it will be more well and good , and also append and update these all claude code development rules as it is explicitly word by word into claude.md okay.

yes but before going i need to tell you that i have been selected now as well and fill the google form for internship , but this form has a lot of info that we can use to further modify our claude.md about raval ai and its all stuff and mission or vision , so do see this as well: (Raval AI Internship Program onboarding text — AI-native marketing platform for strategy, content, SEO/GEO/AEO, social media, analytics, automation; mission to build a world-class AI company from Pakistan; HQ NASTP CEGA Lahore; hybrid model; builder mindset; impact-based evaluation; potential full-time + equity; Website https://raval.it.com/ ; Founder LinkedIn https://www.linkedin.com/in/zain-mudassar-iqbal/ ). and use it please in our claude.md as well okay it will benefit us even more.. then further go for creating the PHR stuff okay.

## Response snapshot

Read both persona files. Analysis: the Backend Architect persona (engineering identity),
the Product Runtime persona (end-user assistant behavior), and the existing CLAUDE.md
(SDD process governance) operate at three distinct, complementary layers — no conflicts.
The only true overlap is the approval boundary, which is consistent across layers.

Applied to CLAUDE.md (append-only, nothing removed):
1. 25 Claude Development Rules — verbatim, word-for-word.
2. Backend Architect & Agentic AI Engineer Persona — kept substance intact, added 3 tie-ins:
   ADR path -> history/adr/ + /sp.adr; "One Platform First" aligned to Phase 1/2/3 roadmap;
   PHR section cross-references existing PHR mechanics (single source of truth).
3. Product Runtime Persona (10 dimensions + paste-ready system prompt + project context).
4. Company Context section — mission (world-class AI company from Pakistan), vision, broader
   product surfaces (strategy/content/SEO-GEO-AEO/social/analytics/automation), HQ (NASTP CEGA
   Lahore), hybrid model, founder/website links, and internship "ways of working" ethos.

## Outcome

- ✅ Impact: CLAUDE.md now carries engineering identity, product-runtime persona, 25 dev rules, and authoritative company mission/vision context in one place.
- 🧪 Tests: none — documentation/governance change; verified via read-back of edits.
- 📁 Files: CLAUDE.md (appended 4 major sections + company context).
- 🔁 Next prompts: optionally extract shared approval-boundary rule into constitution.md; begin /sp.specify for the Social Media Distribution & Scheduling Engine.
- 🧠 Reflection: Layered personas avoid conflict when each states its scope explicitly at the top.

## Evaluation notes (flywheel)

- Failure modes observed: none — additive edits, no unrelated code touched.
- Graders run and results (PASS/FAIL): PASS (no unresolved placeholders; routing correct; verbatim rules preserved).
- Prompt variant (if applicable): none
- Next experiment (smallest change to try): consider a single-source constitution entry for the approval boundary referenced by both personas.
