// Minimal branded 500 HTML shown when SSR fails catastrophically.
export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Raval AI — Temporary Issue</title>
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  body { display: grid; place-items: center; background: #0a0a0a; color: #f5f5f5; }
  main { max-width: 480px; padding: 32px; text-align: center; }
  h1 { font-size: 20px; margin: 0 0 8px; letter-spacing: -0.01em; }
  p { margin: 0 0 20px; color: #a3a3a3; font-size: 14px; line-height: 1.55; }
  a { display: inline-block; padding: 10px 18px; border-radius: 999px; background: #22c55e; color: #0a0a0a; text-decoration: none; font-weight: 600; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>Something went wrong</h1>
  <p>We hit a temporary issue rendering this page. Please try again in a moment.</p>
  <a href="/">Reload</a>
</main>
</body>
</html>`;
}
