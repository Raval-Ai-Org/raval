---
name: secure-coding
description: Secure coding practices for web applications, from a bug hunter's perspective. Use when writing or reviewing code that touches authentication, authorization, user input, file uploads, redirects, outbound requests, SQL, XML, file paths, JWTs, cookies, security headers or APIs (REST/GraphQL).
---

# Secure Coding Guide

Approach code from a bug hunter's perspective and make applications as secure as possible without breaking functionality.

**Key principles**

- Defense in depth: never rely on a single security control
- Fail securely: when something fails, fail closed (deny access)
- Least privilege: grant minimum permissions necessary
- Input validation: never trust user input, validate everything server-side
- Output encoding: encode data appropriately for the context it's rendered in

## Access Control Issues

Users must not access resources or perform actions beyond their permissions.

### Core requirements

For every data point and action that requires authentication:

1. **User-level authorization**
   - Each user only accesses/modifies their own data
   - No user accesses data from other users or organizations
   - Verify ownership at the data layer, not just the route level
2. **Use UUIDs instead of sequential IDs** (UUIDv4 or similar). Only use sequential IDs if explicitly requested.
3. **Account lifecycle handling**
   - User removed from an organization: immediately revoke all access tokens and sessions
   - Account deleted/deactivated: invalidate all active sessions and API keys
   - Use token revocation lists or short-lived tokens with refresh mechanisms

### Checklist

- [ ] Verify user owns the resource on every request (don't trust client-side data)
- [ ] Check organization membership for multi-tenant apps
- [ ] Validate role permissions for role-based actions
- [ ] Re-validate permissions after any privilege change
- [ ] Check parent resource ownership (accessing a comment → verify access to the parent post)

### Common pitfalls

- **IDOR**: always verify the requester may access the requested resource ID
- **Privilege escalation**: validate role changes server-side; never trust role info from the client
- **Horizontal access**: user A accessing user B's resources at the same privilege level
- **Vertical access**: regular user reaching admin functionality
- **Mass assignment**: filter which fields users can update; don't blindly accept the whole request body

### Pattern

```
function getResource(resourceId, currentUser):
    resource = database.find(resourceId)

    if resource is null:
        return 404  # Don't reveal if resource exists

    if resource.ownerId != currentUser.id:
        if not currentUser.hasOrgAccess(resource.orgId):
            return 404  # 404, not 403, to prevent enumeration

    return resource
```

## Client-Side Bugs

### Cross-Site Scripting (XSS)

Every input controllable by the user, directly or indirectly, must be handled against XSS.

**Direct inputs:** form fields (email, name, bio, comments), search queries, uploaded file names, rich text / WYSIWYG content.

**Indirect inputs:** URL parameters and query strings, URL fragments, HTTP headers shown in the app (Referer, User-Agent), third-party API data, WebSocket messages, `postMessage` data, LocalStorage/SessionStorage values if rendered.

**Often overlooked:** error messages that reflect input, PDF/document generators that accept HTML, email templates with user data, log viewers in admin panels, JSON rendered as HTML, SVG uploads (can contain JavaScript), Markdown rendering that allows HTML.

**Protection**

1. Context-specific output encoding
   - HTML: entity-encode (`<` → `&lt;`)
   - JavaScript: JS-escape
   - URL: URL-encode
   - CSS: CSS-escape
   - Use the framework's built-in escaping (React JSX, Vue `{{ }}`)
2. Content Security Policy

   ```
   Content-Security-Policy:
     default-src 'self';
     script-src 'self';
     style-src 'self' 'unsafe-inline';
     img-src 'self' data: https:;
     font-src 'self';
     connect-src 'self' https://api.yourdomain.com;
     frame-ancestors 'none';
     base-uri 'self';
     form-action 'self';
   ```

   - Avoid `'unsafe-inline'` and `'unsafe-eval'` for scripts; use nonces or hashes for necessary inline scripts
   - Report violations: `report-uri /csp-report`
3. Input sanitization: use established libraries (DOMPurify), whitelist tags/attributes for rich text, strip or encode dangerous patterns
4. Headers: `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY` (or CSP `frame-ancestors`)

### Cross-Site Request Forgery (CSRF)

Every state-changing endpoint must be protected.

**Needs protection**

- Authenticated: all POST/PUT/PATCH/DELETE, any GET that changes state (fix these to use proper methods), file uploads, settings changes, payment/transaction endpoints
- Pre-authentication: login (prevents login CSRF), signup, password reset request, password change, email/phone verification, OAuth callbacks

**Mechanisms**

1. CSRF tokens: cryptographically random, tied to the user session, validated on every state-changing request, regenerated after login
2. SameSite cookies: `Set-Cookie: session=abc123; SameSite=Strict; Secure; HttpOnly` (Strict = never sent cross-site; Lax = sent on top-level navigations). Always combine with tokens.
3. Double-submit cookie: token in both cookie and request body/header; server checks they match

**Edge cases and mistakes**

- Validation must NOT depend on whether the token is present; always require it
- Consider unique tokens per form for sensitive operations
- JSON APIs: a JSON content type does not prevent CSRF; validate Origin/Referer AND use tokens
- Overly permissive CORS can bypass SameSite cookies
- Scope tokens; subdomain takeover can lead to CSRF
- Legacy plugins (Flash/PDF uploads) could bypass SameSite
- Never perform state changes on GET
- Never put CSRF tokens in URLs; prefer a custom header (`X-CSRF-Token`)

**Checklist**

- [ ] Token from a secure random generator
- [ ] Token tied to session
- [ ] Validated server-side on all state-changing requests
- [ ] Missing token = rejected
- [ ] Regenerated on authentication state change
- [ ] SameSite set; Secure and HttpOnly on session cookies

### Secret keys and sensitive data exposure

No secrets or sensitive information should be reachable from client-side code.

**Never expose in client code**

- API keys and secrets: third-party keys (Stripe, AWS, ...), database connection strings, JWT signing secrets, encryption keys, OAuth client secrets, internal service URLs/credentials
- Sensitive user data: full card numbers, SSNs, passwords (even hashed), security questions/answers, full phone numbers (mask them), PII not needed for display
- Infrastructure details: internal IPs, database schemas, debug info, production stack traces, server software versions

**Where secrets hide (check these)**: JS bundles and source maps, HTML comments, hidden form fields, data attributes, LocalStorage/SessionStorage, SSR initial state/hydration data, env vars exposed by build tools (`NEXT_PUBLIC_`, `REACT_APP_`).

**Best practice**: keep secrets in environment variables; make calls that need secrets from the backend only.

### Open redirect

Any endpoint accepting a URL to redirect to must be protected.

- **Allowlist validation**: parse the URL and require the hostname to be in an allowlist
- **Relative URLs only**: accept paths like `/dashboard`; require a leading `/` and no `//`
- **Indirect references**: map `?redirect=dashboard` to `/dashboard` server-side

**Bypass techniques to block**

| Technique | Example | Why it works |
| --- | --- | --- |
| `@` symbol | `https://legit.com@evil.com` | Browser goes to evil.com with legit.com as username |
| Subdomain abuse | `https://legit.com.evil.com` | evil.com owns the subdomain |
| Protocol tricks | `javascript:alert(1)` | XSS via redirect |
| Double URL encoding | `%252f%252fevil.com` | Decodes to `//evil.com` after double decode |
| Backslash | `https://legit.com\@evil.com` | Some parsers normalize `\` to `/` |
| Null byte | `https://legit.com%00.evil.com` | Some parsers truncate at null |
| Tab/newline | `https://legit.com%09.evil.com` | Whitespace confusion |
| Unicode normalization | `https://legіt.com` (Cyrillic і) | IDN homograph attack |
| Data URLs | `data:text/html,<script>...` | Direct payload execution |
| Protocol-relative | `//evil.com` | Uses current page's protocol |
| Fragment abuse | `https://legit.com#@evil.com` | Parsed differently by libraries |

IDN homographs: convert URLs to Punycode before validation, or block non-ASCII domains for sensitive redirects.

### Password security

- Minimum 8 characters (12+ recommended); no low maximum (128+ is fine)
- Allow all characters including special ones; don't force specific character classes
- Store with Argon2id, bcrypt or scrypt. Never MD5, SHA1 or plain SHA256.

## Server-Side Bugs

### Server-Side Request Forgery (SSRF)

Any feature where the server requests URLs provided or influenced by users must be protected.

**Potentially vulnerable features**: webhooks, URL previews, PDF generators from URLs, image/file fetching, import from URL, RSS/feed readers, integrations with user-provided endpoints, proxies, HTML-to-PDF/image converters.

**Protection**

- Allowlist approach (preferred): only pre-approved domains
- Network segmentation: run URL-fetching services isolated; block internal network and cloud metadata

**IP and DNS bypass techniques to block**

| Technique | Example |
| --- | --- |
| Decimal IP | `http://2130706433` |
| Octal IP | `http://0177.0.0.1` |
| Hex IP | `http://0x7f.0x0.0x0.0x1` |
| IPv6 localhost | `http://[::1]` |
| IPv6-mapped IPv4 | `http://[::ffff:127.0.0.1]` |
| Short IPv6 | `http://[::]` |
| DNS rebinding | attacker DNS returns external IP first, internal on the second lookup |
| CNAME to internal | attacker domain CNAMEs to an internal hostname |
| URL parser confusion | `http://attacker.com#@internal` |
| Redirect chains | external URL redirects to internal |
| IPv6 scope ID | `http://[fe80::1%25eth0]` |
| Rare IP formats | `http://127.1` |

**DNS rebinding prevention**: resolve DNS before the request, validate the resolved IP is not internal, pin the resolved IP for the request (don't re-resolve), or resolve twice with a delay and require the same external IP.

**Cloud metadata**: block `169.254.169.254` (AWS, GCP, Azure, DigitalOcean), `metadata.google.internal`, `http://metadata`.

**Checklist**

- [ ] Scheme is HTTP/HTTPS only
- [ ] DNS resolved and IP validated as not private/internal
- [ ] Cloud metadata IPs blocked explicitly
- [ ] Redirects limited or disabled; each hop validated if followed
- [ ] Request timeout set
- [ ] Response size limited
- [ ] Network isolation where possible

### Insecure file upload

Validate type, content and size.

1. **Type**: extension against an allowlist AND magic bytes match the expected type; never rely on one check
2. **Content**: verify magic bytes; for images, process with an image library to detect malformed files; for documents, scan for macros/embedded objects; check for polyglot files
3. **Size**: server-side maximum, plus web server/proxy limits; per-type limits

**Common attacks**

| Attack | Description | Prevention |
| --- | --- | --- |
| Extension bypass | `shell.php.jpg` | Check full extension, allowlist |
| Null byte | `shell.php%00.jpg` | Sanitize filename, reject null bytes |
| Double extension | `shell.jpg.php` | Allow only a single extension |
| MIME spoofing | Content-Type set to `image/jpeg` | Validate magic bytes |
| Magic byte injection | valid header prepended to malicious file | Check the whole structure, not just the header |
| Polyglot | valid as both JPEG and JavaScript | Parse as the expected type, reject if invalid |
| SVG with JavaScript | `<svg onload="alert(1)">` | Sanitize SVG or disallow |
| XXE via upload | malicious DOCX/XLSX (XML inside ZIP) | Disable external entities in the parser |
| ZIP slip | `../../../etc/passwd` in archive | Validate extracted paths |
| ImageMagick exploits | crafted images | Keep updated, use policy.xml |
| Filename injection | `; rm -rf /` in name | Sanitize names, use random names |
| Content-type confusion | browser MIME sniffing | `X-Content-Type-Options: nosniff` |

**Magic bytes**

| Type | Hex |
| --- | --- |
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| GIF | `47 49 46 38` |
| PDF | `25 50 44 46` |
| ZIP, DOCX/XLSX | `50 4B 03 04` |

**Secure handling**: rename to random UUIDs and discard the original name; store outside the webroot or on a separate domain/CDN; serve with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and a Content-Type matching the real file type; make uploaded files non-executable.

### SQL injection

1. **Parameterized queries (primary defense)**

   ```sql
   -- VULNERABLE
   query = "SELECT * FROM users WHERE id = " + userId
   -- SECURE
   query = "SELECT * FROM users WHERE id = ?"
   execute(query, [userId])
   ```

2. **ORMs**: use methods that parameterize automatically; be cautious with raw-query methods and ORM-specific injection points
3. **Input validation**: validate types, whitelist allowed values (defense in depth, not the primary defense)

**Injection points to watch**: WHERE, ORDER BY (can't parameterize, whitelist), LIMIT/OFFSET, table and column names (whitelist), INSERT values, UPDATE SET values, dynamic IN lists, LIKE patterns (escape `%` and `_`).

**Additional**: least-privilege database user, disable dangerous functions (e.g. `xp_cmdshell`), never expose SQL errors to users.

### XML External Entity (XXE)

**Vulnerable scenarios**: SOAP, XML-RPC, XML uploads, config parsing, RSS/Atom; indirectly JSON converted to XML, Office documents (ZIP with XML), SVG, SAML assertions, PDF with XFA forms.

**Prevention by parser**

```java
// Java
DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();
dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
dbf.setExpandEntityReferences(false);
```

```python
# Python (lxml), or use defusedxml
from lxml import etree
parser = etree.XMLParser(resolve_entities=False, no_network=True)
```

```php
// PHP
libxml_disable_entity_loader(true);
```

```csharp
// .NET
XmlReaderSettings settings = new XmlReaderSettings();
settings.DtdProcessing = DtdProcessing.Prohibit;
settings.XmlResolver = null;
```

Node.js: use libraries that disable DTD processing by default; with libxmljs set `{ noent: false, dtdload: false }`.

**Checklist**

- [ ] DTD processing disabled if possible
- [ ] External entity resolution disabled
- [ ] External DTD loading disabled
- [ ] XInclude disabled
- [ ] Parser versions patched
- [ ] Validate/sanitize XML before parsing if DTD is needed
- [ ] Consider JSON instead of XML

### Path traversal

```
# VULNERABLE
file_path = "/uploads/" + user_input
file_path = base_dir + request.params['file']
template = "templates/" + user_provided_template
```

1. **Avoid user input in paths**: use indirect references

   ```python
   files = {'report': '/reports/q1.pdf', 'invoice': '/invoices/2024.pdf'}
   file_path = files.get(user_input)  # None if invalid
   ```

2. **Canonicalize and validate**

   ```python
   import os

   def safe_join(base_directory, user_path):
       base = os.path.abspath(os.path.realpath(base_directory))
       target = os.path.abspath(os.path.realpath(os.path.join(base, user_path)))
       if os.path.commonpath([base, target]) != base:
           raise ValueError("Error!")
       return target
   ```

3. **Sanitize input**: reject `..`, absolute path indicators (`/`, `C:`), whitelist characters (alphanumeric, dash, underscore), validate extension

**Checklist**: never use user input directly in paths; canonicalize and check against the base directory; restrict extensions; test with encoding and bypass variants.

## Security headers

Include in all responses:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: [see XSS section]
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Cache-Control: no-store   (for sensitive pages)
```

## JWT security

| Vulnerability | Prevention |
| --- | --- |
| `alg: none` attack | Always verify the algorithm server-side, reject `none` |
| Algorithm confusion | Specify the expected algorithm explicitly, never derive it from the token |
| Weak HMAC secrets | 256+ bit cryptographically random secrets |
| Missing expiration | Always set `exp` |
| Token in localStorage | Use httpOnly, Secure, SameSite=Strict cookies |

```js
// 1. Signing: secrets from environment variables
const secret = process.env.JWT_SECRET;
const token = jwt.sign({
  sub: userId,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (15 * 60), // short-lived
  jti: crypto.randomUUID() // for revocation
}, secret, { algorithm: 'HS256' });

// 2. Sending: protect against XSS and CSRF
res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict' });

// 3. Verifying: whitelist the allowed algorithm
jwt.verify(token, secret, { algorithms: ['HS256'] }, (err, decoded) => {
  if (err) { /* handle invalid token */ }
});
```

**Checklist**

- [ ] Algorithm explicitly specified on verification
- [ ] `alg: none` rejected
- [ ] Secret is 256+ bits of random data (not a phrase)
- [ ] `exp` always set and validated
- [ ] Tokens in httpOnly cookies, not localStorage/sessionStorage
- [ ] Refresh token rotation (old refresh token invalidated on use)

## API security

### Mass assignment

```js
// VULNERABLE: user can send { role: "admin" }
User.update(req.body)

// SECURE: whitelist allowed fields
const allowed = ['name', 'email', 'avatar']
const updates = pick(req.body, allowed)
User.update(updates)
```

Applies to any ORM/framework: always define which fields a request may modify.

### GraphQL

| Vulnerability | Prevention |
| --- | --- |
| Introspection in production | Disable it in production |
| Query depth attack | Limit depth (e.g. 10 levels) |
| Query complexity attack | Calculate and enforce cost limits |
| Batching attack | Limit operations per request |

```js
const server = new ApolloServer({
  introspection: process.env.NODE_ENV !== 'production',
  validationRules: [
    depthLimit(10),
    costAnalysis({ maximumCost: 1000 })
  ]
})
```

## General principles

When generating code, always:

1. Validate all input server-side; never trust client-side validation alone
2. Use parameterized queries; never concatenate user input into queries
3. Encode output contextually (HTML, JS, URL, CSS differ)
4. Apply authentication checks on every endpoint, not just at routing
5. Apply authorization checks for the specific resource
6. Use secure defaults
7. Handle errors securely; don't leak stack traces or internals
8. Keep dependencies updated; use tools to track vulnerable ones
9. When unsure, choose the more restrictive option and document the security consideration in a comment
