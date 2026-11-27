import type { TermsSection } from "./terms";
export const PRIVACY_UPDATED = "27 November 2026";
// The operator named here must match Meta Business Verification and Google verification documents exactly.
// Replace with the registered company name and registered address before submitting to Meta or Google.
export const LEGAL_ENTITY = "Mellox (Private) Limited (SECP CUIN 0367536)";
export const LEGAL_ADDRESS = "Lahore, Pakistan";
/** How long Instagram and Facebook comments and messages are kept (the inbox must delete on this schedule). */
export const META_MESSAGE_RETENTION_DAYS = 90;
/** Days within which data from a disconnected or deleted Meta account is removed. */
export const META_DELETION_DAYS = 30;
export const PRIVACY_PREFACE = [
  "This Privacy Policy explains how Mellox AI (Mellox, we, us) accesses, collects, uses, stores and shares information through https://mellox.ai, its application and connected services. Mellox provides AI marketing, content creation, analytics, SEO/GEO, scheduling and integrations for businesses and agencies.",
  `The operator is ${LEGAL_ENTITY}, ${LEGAL_ADDRESS}. Contact privacy@mellox.ai or https://mellox.ai/contact.`,
  "This policy describes processing; it does not replace consent where required. Connecting Google, Instagram, Facebook or any other service is optional and separate from signing into Mellox.",
];
export const PRIVACY: TermsSection[] = [
  {
    id: "information",
    title: "Information we collect",
    paras: [
      "We receive information you supply, data from accounts you authorize, technical records needed to operate the service, and public business information used for research. Businesses must have authority to provide their clients' information.",
    ],
    list: [
      "Account and workspace information: name, email, profile, authentication identifiers, roles, invitations, brand websites, Brand DNA, audience notes, strategy and memory.",
      "Content and communications: prompts, conversations, drafts, images, videos, reference uploads, approvals, schedules, shared reports and support requests. Do not upload private information you are not authorized to process.",
      "Billing: plans, credits, purchases and transaction records. Stripe processes payment details; Mellox uses payment identifiers rather than full card numbers.",
      "Technical records: feature usage, timestamps, AI model/token/cost records, errors and security/audit events. Hosting services may process IP addresses, browser and device information.",
      "Public sources: your website, competitor websites, public search results and business information for brand research, SEO/GEO and AI visibility analysis.",
    ],
  },
  {
    id: "google-data",
    title: "Google Analytics and Search Console: data and purpose",
    paras: [
      "Connecting Google Analytics and Google Search Console is optional. With your permission, Mellox reads reports from your selected property and site to bring website traffic, engagement and search performance into your own marketing dashboards and insights. A workspace admin starts the connection through Google's consent screen and selects a GA4 property and/or Search Console site. These read-only reports also support traffic/search trends and SEO experiment measurement; Mellox cannot edit Google properties, site settings or search results. The next section explains how relevant signals and summaries are processed by AI.",
    ],
    list: [
      "Permissions: https://www.googleapis.com/auth/analytics.readonly and https://www.googleapis.com/auth/webmasters.readonly. The connector also requests openid and email to label and identify the connected account. It does not request Gmail, Drive, contacts or Analytics/Search Console write access.",
      "Selection metadata: GA4 property identifiers, property/account display names, time zone and currency; Search Console site URLs and permission levels; Google account identifier, email, granted scopes and connection timestamps.",
      "GA4 dashboard reports: daily sessions, total/new users, engaged sessions, page views, key events, average session duration and bounce rate; traffic channel, source/medium, landing page including query string, country and device breakdowns. These are aggregate reports, not an individual visitor tracking feed.",
      "Search Console reports: search queries, page URLs, dates, countries and devices; clicks, impressions, click-through rate and average position. Google may omit some queries. URL parameters and query text can contain personal information: avoid sensitive information in your site's URLs.",
      "SEO experiments: selected page/date Search Console measurements and GA4 landing-page, session source, channel, sessions, key events and purchase revenue reports measure experiment outcomes, organic traffic and AI referral traffic. Experiment results and reports derive from those measurements.",
      "Sync: the initial dashboard fetch requests up to 180 days of reports. Scheduled and manual syncs refresh recent days. The fetch window is not a deletion schedule.",
    ],
  },
  {
    id: "google-ai",
    title: "Google data and AI processing",
    paras: [
      "Yes, Google-derived data is processed by AI. After synchronization Mellox can automatically explain measured changes. Selected aggregate signals, relevant page/query labels and your business name/website are sent through OpenRouter to the model provider selected for that feature. Analytics summaries can also be included in requested AI chat and recommendations. OAuth tokens are not sent in AI prompts.",
      "This provides insights for your own workspace, not model training. Mellox does not use Google API data, including aggregated or derived data, to train generalized or non-personalized AI/ML models. Its text gateway requests OpenRouter's data_collection: deny setting. This is not a zero-retention guarantee: each model provider's own terms govern its short-term logging for abuse and safety monitoring.",
      "Before a new Google connection Mellox asks you to acknowledge AI processing and sharing. If you do not want these Google-derived AI features, do not connect, or disconnect the integration. New Google data purposes require updated disclosures and consent before use.",
    ],
  },
  {
    id: "google-limited-use",
    title: "Google API Services and Limited Use",
    paras: [
      "Mellox AI's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements, and the Google APIs Terms of Service (https://developers.google.com/terms). These restrictions cover raw, aggregated, anonymized and derived Google data.",
    ],
    list: [
      "Use is limited to the prominent user-facing features described here. Google data is not sold, used for advertising or retargeting, supplied to data brokers, used for surveillance, or used to determine creditworthiness or lending eligibility.",
      "Transfers are limited to providing/improving those features with user consent, necessary security purposes, applicable law, or a merger/acquisition/asset sale with explicit prior user consent. General business-transfer language does not override these restrictions.",
      "Human access is limited to affirmative permission to view specific data, necessary security investigation, applicable law, or aggregated internal operations permitted by the policy and applicable law. Workspace members and people you deliberately share reports with can see the information you authorize them to see.",
      "Google APIs and Google-derived data must never be used to create, facilitate or distribute AI-generated non-consensual intimate imagery (NCII), non-consensual synthetic sexual content or exploitation. See https://mellox.ai/safety and https://mellox.ai/terms.",
    ],
  },
  {
    id: "meta-data",
    title: "Instagram and Facebook: data and purpose",
    paras: [
      "Connecting an Instagram professional account (Business or Creator) or a Facebook Page is optional. A workspace admin starts the connection through Meta's own sign-in and permission screen and chooses which accounts and Pages Mellox may use. Mellox uses this access only for the features of that workspace: publishing the posts you approve, showing how they perform, and, if you turn it on, showing comments and messages so your team can answer them from Mellox.",
    ],
    list: [
      "Account information: the account or Page name, username, profile picture, account identifiers and the permissions you granted.",
      "Your posts and their performance: the media and captions you publish, and insights Meta provides such as reach, views, likes, comments, saves and shares. These are your business's own figures, not a feed about individual visitors.",
      "Comments and messages (only if you turn on replies): comments on your posts and Direct Messages or Messenger conversations sent to your account, with the sender's public name, username and profile picture as Meta provides them, and the time they were sent. Mellox reads only conversations with your own account.",
      "Replies: Mellox sends a reply only when a person on your team presses Send, when your team has switched on a reply rule for that account, or when your team has switched on Mox's auto-reply. Auto-reply answers only from your brand's own facts and your team's answers, never states a figure your brand didn't give, and leaves complaints, orders, payments and anything sensitive to a person. Automatic replies follow Meta's messaging rules, including replying to a message only within 24 hours of the person's last message, and always let the person reach a human.",
      "AI drafts: to draft or decide a reply, the comment or message, the conversation so far and your brand's own facts are sent to an AI model through Mellox's model gateway (KIE, with OpenRouter as the fallback), as described under Providers. It is used to write that reply only, never to train models.",
      "What Mellox never does with Meta data: sell it, use it for advertising or retargeting, build profiles of the people who comment or message you, share it with data brokers, or use it for anything your workspace did not ask for. Mellox follows the Meta Platform Terms (https://developers.facebook.com/terms) and Developer Policies.",
      `Keeping and deleting: comments and messages are deleted ${META_MESSAGE_RETENTION_DAYS} days after they arrive, and everything from an account is deleted within ${META_DELETION_DAYS} days of disconnecting it, deleting the workspace or removing Mellox in your Instagram or Facebook settings. See https://mellox.ai/data-deletion.`,
    ],
  },
  {
    id: "storage-security",
    title: "Storage, OAuth tokens and access",
    list: [
      "Supabase stores workspace data, connection metadata, daily Google aggregates/breakdowns, sync jobs, generated insights and experiment measurements/results. Database row-level security and server workspace/role checks restrict customer access. Workspace members can read reports; connector changes require admins.",
      "Google access and refresh tokens are encrypted with AES-256-GCM using a server-held encryption key in a server-only credentials table. They refresh authorized access and are not returned to the browser. Short-lived OAuth state is bound to the initiating user, uses an encrypted PKCE verifier and is consumed once.",
      "Google reports are processed on Mellox's server. Tenant-scoped AI response caches use configured Redis or in-process memory; default text response caching lasts 30 minutes, with feature-specific lifetimes where configured. Summaries in conversations/reports are separate stored copies.",
      "HTTPS calls to Google, server-held secrets, role checks, scoped database operations and audit records help protect information. No system is perfectly secure. We do not claim security certifications or application-level encryption of all workspace data. Our database and storage providers encrypt data at rest and keep their own backups. Production access is limited to the Mellox staff who operate the service, and staff actions in the admin console are recorded in an audit log that cannot be edited.",
    ],
  },
  {
    id: "sharing",
    title: "Providers, integrations and sharing",
    paras: [
      "Providers receive the data necessary for the feature used. The following are present in the implementation; configuration determines activation. The Analytics connector does not send Google data to advertising tags, payment services or image/video generators.",
    ],
    list: [
      "Google: OAuth exchange/refresh/revocation and report requests. Google's own handling is covered by https://policies.google.com/privacy. Optional Google sign-in uses identity information for authentication, separately from the data connector. YouTube connections use YouTube API Services and are also subject to https://www.youtube.com/t/terms.",
      "Supabase: authentication, database and file storage, including Google connection records/reports. Application hosting and configured Redis providers: server execution, infrastructure logs and caches. These providers may run in regions outside your country, under their own data processing terms.",
      "OpenRouter and routed model providers: prompts and relevant context for AI analysis/generation, including Google-derived signals/summaries for analytics explanations and relevant chat, and Instagram/Facebook comments or messages when you ask Mellox to draft a reply. Every request asks OpenRouter to route only to providers that do not collect prompts for training (data_collection: deny). The models used for each feature change as better or cheaper ones appear; none of them may train on your data under these settings.",
      "Meta (Instagram and Facebook) and Composio: when you connect an Instagram professional account or a Facebook Page, Mellox sends the posts you publish and the replies you send to Meta, and reads the data described under Instagram and Facebook below. Composio, our integration provider, holds the sign-in tokens for accounts connected through it; Mellox stores only Composio's account identifiers. Meta's own handling is covered by https://www.facebook.com/privacy/policy.",
      "KIE (model gateway): prompts and relevant context for AI text, chat and reply drafts, including Instagram/Facebook comments or messages when Mellox drafts or decides a reply, routed to the model chosen for that feature. Used to answer that request only.",
      "KIE and OpenRouter media services: creative prompts/reference images for generation. AI safety classification also processes prompts/images. These media features do not require your Analytics or Search Console connection.",
      "Post for Me and connected social/CMS services: account identity, content/media and publishing/performance information. Canva, Notion, Slack, GitHub, WordPress and Webflow receive material needed for the integrations you enable. Stripe processes payments; Resend sends service communications; configured research/monitoring providers support public-web analysis and diagnostics.",
      "Your chosen recipients: workspace members, connected AI assistants and share/client-portal link recipients can see what their feature permissions allow. Shared experiment reports may include Google-derived results. Exported, published or recipient-held copies are controlled outside Mellox.",
      "Necessary legal/security disclosures remain subject to Limited Use. We do not sell Google or Meta data or authorize providers to use it for their own advertising or generalized model training.",
    ],
  },
  {
    id: "retention-deletion",
    title: "Retention, revocation and deletion",
    paras: [
      "Workspace content, Google report history and experiment results are kept while your workspace exists, so your dashboards and history keep working, and are deleted when you delete the workspace or ask us to. Instagram and Facebook comments and messages follow the shorter schedule below. Security and audit records, and records we must keep by law (such as billing and tax records), are kept only as long as those purposes need. Backups held by our providers roll over on their own schedules; deleted data leaves them as they expire.",
    ],
    list: [
      `Instagram and Facebook comments and messages are deleted ${META_MESSAGE_RETENTION_DAYS} days after they were received. If you disconnect the account, delete the workspace, remove Mellox in your Instagram or Facebook settings, or ask us to delete your data, everything Mellox holds from that account is deleted within ${META_DELETION_DAYS} days. How to ask: https://mellox.ai/data-deletion.`,
      "Disconnect in Mellox: use Disconnect in the workspace Analytics Google data connections panel. Mellox attempts Google revocation, deletes stored credentials, removes selected sources and cascading dashboard reports/sync jobs, and deletes analytics insights. Database failures are surfaced. External revocation is best effort; independently remove access at Google if needed.",
      "Remove/change a property or site: source removal deletes its dashboard reports/sync rows and clears analytics insights. Selecting a different source replaces the old source's dashboard data.",
      "Connection history and audit events can remain after disconnection, including the external account identifier and connection/status timestamps. The disconnected login label is cleared; retention or deletion of these operational records requires review of the applicable security and legal needs.",
      "Revoke at Google: remove Mellox at https://myaccount.google.com/connections. This prevents subsequent authorized access when Google rejects the grant; it does not itself delete previously stored Mellox data. Also disconnect or request deletion.",
      "Other copies: experiment measurements/results, saved chat and exported/shared reports may contain Google-derived information without a source linkage. Disconnect does not erase every such copy. Request deletion at privacy@mellox.ai, identifying the workspace/connection. Cache entries expire at their configured TTL; backups expire on their providers' schedules.",
      "Use available owner controls or privacy@mellox.ai for account/workspace deletion and export. We verify authority and explain legally necessary retention or recipient-controlled copies. Cancelling billing alone is not a deletion request.",
    ],
  },
  {
    id: "cookies",
    title: "Website cookies and consent",
    paras: [
      "Essential authentication and preference storage supports the service. Optional public-website scripts are gated by cookie category and configured vendor IDs. The code supports Google Analytics, Plausible, Microsoft Clarity, Vercel Analytics/Speed Insights, Meta Pixel and LinkedIn Insight Tag; production activation requires confirmation. These visitor tools are separate from reading your business's Google reports.",
      "Change your choices using Cookie Settings in the footer; see https://mellox.ai/cookies. A script already loaded may remain active until reload. Withdrawing website cookie consent does not disconnect the Google data integration.",
    ],
  },
  {
    id: "rights",
    title: "Rights, legal bases and international processing",
    paras: [
      "Depending on applicable law you may access, correct, export or delete personal information, restrict/object to processing, withdraw consent or complain to a supervisory authority. Contact privacy@mellox.ai or https://mellox.ai/contact. We may verify identity/workspace authority and respond within applicable legal deadlines. No unverified universal deadline is promised.",
      "Processing can rely on the service contract, necessary legitimate interests such as security, legal duties or consent for optional connections/tools, as applicable. Withdrawal does not undo prior lawful processing. If a business provided your information, contact that business because it controls workspace instructions.",
      `Providers may process information outside your country. Where they do, we rely on their published data processing terms and, where they offer them, standard contractual clauses. The operator is based in ${LEGAL_ADDRESS}. Mellox is intended for adult business users, not children. Report children's information or unauthorized data to our privacy contact.`,
    ],
  },
  {
    id: "contact-changes",
    title: "Safety reports, contact and changes",
    paras: [
      "Report suspected NCII, exploitation, impersonation or abuse to support@mellox.ai or https://mellox.ai/contact. Include a content/report link and context, without attaching intimate imagery or unnecessary sensitive details. Reports and enforcement records support abuse investigation. See https://mellox.ai/safety.",
      "The update date appears above. Material Google or Meta data access/use/sharing changes require notice and renewed consent before a new purpose is enabled. privacy@mellox.ai and support@mellox.ai are monitored by the Mellox team, which handles safety reports and deletion requests.",
    ],
  },
];
