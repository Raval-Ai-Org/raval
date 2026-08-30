# Meta Graph API Contract Notes (v18.0)

**Feature**: `002-instagram-adapter` · **Phase**: 1 · **Date**: 2026-08-03

These are the external Meta contracts the feature consumes. All URLs use Graph API `v18.0` to match the existing codebase.

## OAuth (engine-facing, unchanged shape)

| Endpoint (engine)                                           | Purpose                                                                    |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `GET /api/v1/accounts/oauth/{platform}/start`               | Returns `authorization_url` + `state_token`; stores durable state (Redis). |
| `GET /api/v1/accounts/oauth/{platform}/callback?code&state` | Exchanges code, resolves profile/Page/IG, stores encrypted account.        |

`platform` allowlist becomes `twitter | linkedin | facebook | instagram`.

## Meta endpoints consumed

### 1. Authorize dialog (browser redirect)

```
https://www.facebook.com/v18.0/dialog/oauth
  ?client_id={RAVALAI_META_APP_ID}
  &redirect_uri={FACEBOOK_CALLBACK_URL}
  &scope=pages_manage_posts,pages_read_engagement,pages_show_list
  &state={state_token}
```

Instagram adds: `instagram_basic,instagram_content_publish`.

### 2. Code → token exchange

```
GET https://graph.facebook.com/v18.0/oauth/access_token
  ?client_id={id}&client_secret={secret}&redirect_uri={url}&code={code}
```

Returns short-lived user access token.

### 3. Long-lived token (connect time)

```
GET https://graph.facebook.com/v18.0/oauth/access_token
  ?grant_type=fb_exchange_token&client_id={id}&client_secret={secret}
  &fb_exchange_token={short_token}
```

### 4. Resolve Page identity (facebook connect)

```
GET https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token&access_token={user_token}
```

→ pick primary Page: `page_id`, `page_access_token`.

### 5. Resolve linked Instagram account (instagram connect)

```
GET https://graph.facebook.com/v18.0/{page_id}?fields=instagram_business_account&access_token={page_token}
```

→ `{instagram_business_account: {id: <ig_user_id>}}`. Error (e.g., no linked IG) → `FatalContentError` "Instagram account must be a Professional account linked to a Facebook Page."

### 6. Publish — image

```
POST https://graph.facebook.com/v18.0/{ig_user_id}/media
  image_url=<public_https_url>  caption=<text>  access_token=<page_token>
→ { "id": "<creation_id>" }
```

### 7. Publish — video

```
POST https://graph.facebook.com/v18.0/{ig_user_id}/media
  video_url=<public_https_url>  media_type=VIDEO  caption=<text>  access_token=<page_token>
→ { "id": "<creation_id>" }
```

### 8. Confirm publish (both image and video)

```
POST https://graph.facebook.com/v18.0/{ig_user_id}/media_publish
  creation_id=<creation_id>  access_token=<page_token>
→ { "id": "<media_id>" }
```

### 9. Public URL

```
GET https://graph.facebook.com/v18.0/{media_id}?fields=permalink&access_token=<page_token>
→ { "permalink": "https://www.instagram.com/p/..." }
```

## Error taxonomy (external → internal)

| External signal                       | Internal error                   | Retryable |
| ------------------------------------- | -------------------------------- | --------- |
| HTTP 401, or 400 + code `190`, or 403 | `AuthError`                      | no        |
| HTTP 429, or code `18`/`613`          | `RateLimitError` (+ Retry-After) | yes       |
| HTTP 5xx, timeout, connection error   | `TransientError`                 | yes       |
| Other 4xx                             | `FatalContentError`              | no        |

## Published post contract (unchanged engine shape)

`PostTarget` gains: `platform_post_id` = IG media id (or FB post id), `platform_post_url` = permalink, `status` = `published`.
