# Wix connector

Mellox connects to a Wix site directly so it can publish articles to Wix Blog and
apply AI Visibility (GEO) fixes to a page's SEO settings. It is modelled on the
Webflow connector. Researched against the Wix REST API docs on 2026-11-02
(dev.wix.com/docs/rest).

## What the founder must set up

Nothing here can run until a Wix app exists. In the Wix Dev Center
(dev.wix.com → My Apps → Create New App):

1. **Create an app** for Mellox. Keep it unlisted while testing (no App Market
   listing is needed to install it through a link).
2. **OAuth page** (Develop → OAuth):
   - App URL / Redirect URL: `https://<mellox-host>/api/integrations/wix/callback`
   - Copy the **App ID** and **App Secret Key**.
3. **Permissions** (Develop → Permissions). Request exactly these:

   | Permission (as named in the Dev Center) | Scope id                                | Why                                                                       |
   | --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
   | Manage Your App                         | `SCOPE.DC-APPS.MANAGE-YOUR-APP`         | read the app instance: site id, name, address, installed Wix apps         |
   | Read Site Owner Email                   | `SCOPE.DC-MANAGE.READ-SITE-OWNER-EMAIL` | find the owner's member to sign blog posts when the blog has no posts yet |
   | Read Blog                               | `SCOPE.DC-BLOG.READ-BLOGS`              | detect the blog, find posts by slug                                       |
   | Manage Blog                             | `SCOPE.DC-BLOG.MANAGE-BLOG`             | create and publish posts                                                  |
   | Read Members                            | `SCOPE.DC-MEMBERS.READ-MEMBERS`         | look up the owner's member id by email                                    |
   | Manage SEO Settings                     | `SCOPE.PROMOTE.MANAGE-SEO`              | read and write page / post SEO tags for GEO fixes                         |

   Check the scope ids in the Dev Center's picker when adding them; the names
   above are what to search for. If Wix rejects a call for a missing permission,
   Mellox shows the person a plain error; it does not guess which permission is
   missing.

4. **Share link** (only while unlisted): Distribute → copy the share URL id.
5. **Environment** (`src/server/env.ts`):

   | Variable                   | Value                                                                            |
   | -------------------------- | -------------------------------------------------------------------------------- |
   | `WIX_CLIENT_ID`            | App ID                                                                           |
   | `WIX_CLIENT_SECRET`        | App Secret Key (also signs `signedInstance`)                                     |
   | `WIX_REDIRECT_URI`         | the callback URL above (https unless localhost)                                  |
   | `WIX_SHARE_URL_ID`         | optional, the unlisted app's share URL id                                        |
   | `WIX_TOKEN_ENCRYPTION_KEY` | 32-byte key, same format as the other connector keys (`connectorEncryptionKeys`) |

6. Apply migration `supabase/migrations/20261102130000_wix_connector.sql`.

Users never paste a key: they click Connect, pick the site in Wix's own
installer window, and come back.

## How Wix auth works for a new app

- **Custom OAuth (code + refresh token) is deprecated for new apps.** Mellox
  uses the current flow: client credentials per site.
  `POST https://www.wixapis.com/oauth2/token` with
  `{grant_type: "client_credentials", client_id, client_secret, instance_id}`
  returns an access token valid for 4 hours. The `Authorization` header carries
  the raw token (no `Bearer`).
- The lasting credential is the site's **`instanceId`**. Mellox stores it
  encrypted (`wix_oauth_credentials.instance_id_enc`) and mints a new token
  2 minutes before the cached one expires.
- **Install flow:** `startWixConnect` stores a `connector_install_states` row
  and opens
  `https://www.wix.com/app-installer?appId=…&postInstallationUrl=<callback?state=…>`
  (+ `shareUrlId`). After install Wix redirects to the callback with
  `instanceId`, `signedInstance`, `appId`, `tenantId` and keeps our `state`.
- **`signedInstance`** is `<sig>.<data>`; `sig` is base64url HMAC-SHA256 of
  `data` with the App Secret. Mellox checks the signature, that its
  `instanceId` matches, and that it was signed in the last 30 minutes
  (`signed-instance.server.ts`). Only then is a token minted and the site read.
- **Disconnect:** Wix has no token revoke or uninstall API for apps. Mellox
  forgets the instance id and marks the connection revoked; the person removes
  the app in their Wix dashboard to cut access completely (the card says so).
- One Wix connection per workspace (one site per install). Connecting another
  site replaces it.

## Endpoints Mellox uses

All in `src/server/connectors/wix/api.server.ts`, the only file that talks to
Wix. Reads are retried; writes are sent once.

| Use                    | Call                                                                        | Permission                                                      |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| token                  | `POST /oauth2/token`                                                        | —                                                               |
| site info              | `GET /apps/v1/instance`                                                     | Manage Your App (+ Read Site Owner Email for `ownerInfo.email`) |
| blog present / author  | `GET /blog/v3/posts?paging.limit=&sort=PUBLISHED_DATE_DESC&fieldsets=URL`   | Read Blog                                                       |
| find a post            | `GET /blog/v3/posts/slugs/{slug}?fieldsets=URL`                             | Read Blog                                                       |
| create + publish       | `POST /blog/v3/draft-posts` with `publish: true`                            | Manage Blog                                                     |
| publish a stored draft | `POST /blog/v3/draft-posts/{id}/publish` (idempotent)                       | Manage Blog                                                     |
| owner as member        | `POST /members/v1/members/query` (`loginEmail`)                             | Read Members                                                    |
| page / post SEO tags   | `GET` / `PATCH /promote/seo/v1/item-seo-tags/{STATIC_PAGE\|BLOG_POST}/{id}` | Manage SEO Settings                                             |
| list static pages      | `GET /promote/seo/v1/item-seo-tags/STATIC_PAGE?paging.limit=100`            | Manage SEO Settings                                             |

## Article publishing

`src/server/articles/publish.server.ts` (`publishWix`), body built by
`src/lib/articles/wix-ricos.ts` (markdown → Ricos: paragraphs, headings,
lists, quotes, code, dividers, bold/italic, safe links; key takeaways first,
FAQ last).

- **Blog detected = Wix Blog answers.** `detectWix` lists posts; a 4xx means
  the Wix Blog app isn't added, and the person is told to add it in the Wix
  editor. Mellox can't add a blog to a Wix site.
- **Author.** Third-party apps must give a `memberId`. Mellox uses the stored
  `site_blog_settings.wix_member_id`, else the author of an existing post, else
  the site owner's member found by email; otherwise the publication needs
  attention.
- **Never a blind create.** The post is created and published in one call; the
  draft id is stored right after. A retry first looks for the slug: a post with
  the same title is adopted, a different post with that slug stops for a
  person, a stored draft is published again (idempotent) instead of created.
- The predicted address is `https://<host>/post/<slug>`. As everywhere, only
  the live-page check marks a publication verified.

## GEO fixes: what the Wix API really writes

Wix's SEO API writes **a static page's or a blog post's own head tags** (title,
meta, link, JSON-LD script). Each write replaces the item's whole tag list, so
Mellox reads, changes one tag, and sends the full list back
(`src/lib/sites/wix-seo.ts`). Static pages have a draft and a published
revision; Mellox writes the draft, then the published one (`publish: true`).

| Field                          | Wix page / post                                 | Elsewhere |
| ------------------------------ | ----------------------------------------------- | --------- |
| SEO title                      | applied                                         | assisted  |
| meta description               | applied                                         | assisted  |
| canonical                      | applied                                         | assisted  |
| noindex (robots meta)          | applied                                         | assisted  |
| Open Graph title / description | applied                                         | assisted  |
| page JSON-LD                   | applied                                         | assisted  |
| site-wide JSON-LD              | assisted                                        | assisted  |
| robots.txt, llms.txt           | assisted (Wix manages them in its SEO settings) | assisted  |
| page text, image alt           | assisted (Wix editor)                           | assisted  |

"Assisted" means Mellox gives the exact value and where to paste it. The
rule-level `CMS_MANUAL_RULES` list was left as it is: it is shared with
WordPress and Webflow, so Wix's limits are in `wixFieldSupport`
(`src/lib/geo/cms-fixes.ts`). A page is matched to a URL only by the canonical
Wix renders for it (`matchStaticPage`); a `/post/<slug>` URL is a blog post.
Anything not matched is assisted, never guessed. Site SEO settings accept meta
tags only and tags can be written for the site's main language only, so other
languages stay assisted.

## Site detection

`wixFromHtml` (`src/lib/sites/fingerprint.ts`) recognises Wix by its generator
meta or `static.parastorage.com` / `wixstatic.com` assets plus the page's
`metaSiteId`. `resolve.server.ts` binds a host to the connected Wix site only
when the live page is Wix and, if the page states a `metaSiteId`, it matches
the connected site id.

## Not verified yet (no Wix app exists)

Check these on the first real site and fix the code if they differ:

- the exact scope ids in the permission table;
- that the `Authorization` header takes the raw token;
- the value in `installedWixApps` for Wix Blog (Mellox detects the blog by
  calling the Blog API, so this only affects the "blog" line on the card);
- the posts list query parameters (`paging.limit`, `sort`, `fieldsets=URL`);
- that a post's slug equals the `seoSlug` sent on create;
- whether blog-post SEO tags need `publish: true` (Mellox writes the item once
  without it);
- the Ricos decoration shapes (bold `fontWeightValue`, link `target`);
- that published Wix pages carry `"metaSiteId"` in their HTML.

## Follow-ups

- Listen for the **App Instance Removed** webhook to mark the connection
  revoked as soon as the app is removed in Wix (today the next call fails and
  the card asks to connect again).
- Sites with more than 100 static pages: page through `listItemSeoTags`.
- Add Wix to the GEO "Fix all" site picker tiles (`SiteConnectPicker`).

## Live check

`tests/live/wix.live.ts` — needs `WIX_CLIENT_ID`, `WIX_CLIENT_SECRET`, the
service role key and a workspace with an active Wix connection. Reads only by
default; `SITES_LIVE_WRITE=yes` changes and restores the home page's meta
description and publishes one test post (left for a person to delete).
