# Marketing knowledge (Round 5)

Pure modules, distilled and rewritten in Mellox's own words. No source text is copied. Decision record: [ADR-0047](../adr/0047-marketing-knowledge-and-creative-review.md).

| Module | What it holds | Main sources |
|---|---|---|
| `src/lib/studio/knowledge/frameworks.ts` | 12 argument shapes, 5 awareness stages, the sales-clarity rule, funnel jobs | marketingskills (MIT), copywriting-vault (MIT), kostja94/marketing-skills (MIT) |
| `knowledge/skills.ts` | 22 specialist skills with a check each | marketingskills, social-media-skills (MIT), instagram-skill (MIT), instagram-carousel-skill (MIT) |
| `knowledge/industries.ts` | 20 industry playbooks: look, avoid, wants, doubts, proof, layouts, humour | brand-system-skill (CC BY 4.0), kostja94 |
| `knowledge/select.ts` | `knowledgeFor` / `knowledgeRule`: the ≤1,800-character block per piece | — |
| `src/lib/studio/memes/` | mechanic rules, fatigue list, meme craft, 133 template box maps | meme-maker (MIT), memegen (MIT; pictures belong to their owners) |
| video rules in `prompts.ts` | retention (open loop, re-hook at ~40%), CTA fitted to the goal | viral-tiktok-skills (MIT), social-media-skills |

The clone report, with commits and licences, is at `H:\MelloxResearch\notes\clone-report.md`. Licences are recorded but not enforced (owner's decision, 2026-11).

**Rules:**
- Add an entry, never rename an id.
- Keep every line brand-neutral.
- A skill never adds a fact.
- Re-import meme templates with:

```bash
node scripts/memes/import-memegen.mjs <memegen templates dir> <meme-templates.json>
```
