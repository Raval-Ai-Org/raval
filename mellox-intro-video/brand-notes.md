# Mellox AI — revised brand direction

The user's revision explicitly requires a black background and a complete design/copy replacement. The film now follows Mellox's pure-black product theme, not the navy marketing sections used in v1.

- Full-frame base: #000000. Product illustrations: #080808 with #262626 hairlines. Source product dark theme: src/styles.css around line 373.
- Primary text: #F6F6F4; secondary #92928E. The source's product dark foreground is approximately #F7F7F7.
- Exact Ultra Moss: #CBE960, from src/marketing/globals.css and public/assets/mellox-logo.svg. Used in highlights, controls, pills and marks.
- Typography: Google Sans Flex 400/500/600, matching src/styles.css and src/app/layout.tsx. Headline tracking is tightly set and per-line widths are measured. The wordmark is Michroma 400, matching src/components/brand/Logo.tsx. No synthetic wordmark bold.
- Canonical logo: public/assets/mellox-logo.svg, copied unchanged to assets/mellox-logo.svg. The film respects its viewBox aspect ratio.
- Brain geometry: public/brains/brand.svg, customer.svg, competitor.svg, market.svg. Local film copies preserve paths and unify fills in Ultra Moss.
- All font binaries and OFL licenses are local under assets/fonts/. Every requested font weight is loaded before a frame can be exported.

The script describes real Mellox capabilities: Brand DNA; Brand, Customer, Competitor and Market brains; content creation; scheduling and publishing; prompt/mention visibility tracking; and Autopilot. Sources: MELLOX_AI_MASTER_CONTEXT.md, src/marketing/components/Workflow.tsx, src/marketing/lib/features.tsx. Product panels are original promotional illustrations, not captured application screens. No invented metrics or guaranteed outcomes are included.
