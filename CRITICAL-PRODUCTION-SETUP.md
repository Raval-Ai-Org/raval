# CRITICAL PRODUCTION SETUP REQUIREMENTS

## ⚠️ Database Webhook URL Migration

The pg_cron scheduler in the database migration `supabase/migrations/20260709194553_bb8d43fe-2f5e-48cb-9c77-8042cb96e8be.sql` contains a hardcoded webhook URL pointing to the development/staging domain:

```sql
url := '<DEPLOYMENT_URL>/api/public/hooks/competitor-watch'
```

### Action Required Before Production Deployment

This must be updated to point to your production domain. There are two approaches:

#### Option A: Update via Supabase SQL Editor (Immediate Fix)

1. Go to Supabase Dashboard → SQL Editor
2. Run this query to update the existing cron job:
   ```sql
   SELECT cron.unschedule('competitor-watch-scan');

   SELECT cron.schedule(
     'competitor-watch-scan',
     '*/30 * * * *',
     $$
     SELECT net.http_post(
       url := 'https://YOUR_PRODUCTION_DOMAIN.com/api/public/hooks/competitor-watch',
       headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_S7mXBNliJnHUMWfCn4jS-Q_-Svjt7JV"}'::jsonb,
       body := '{}'::jsonb
     );
     $$
   );
   ```
3. Replace `YOUR_PRODUCTION_DOMAIN.com` with your actual production domain

#### Option B: Create New Migration for Production

1. Create a new migration file in `supabase/migrations/`:
   ```
   [timestamp]_update-competitor-watch-webhook.sql
   ```
2. Add the same query as Option A
3. This keeps the original migration unchanged and documents the production-specific update

### Environment-Specific Setup

- **Local Development**: No action needed (uses http://localhost:3000 or your local dev URL)
- **Staging**: Update webhook URL to staging domain
- **Production**: Update webhook URL to production domain before first deployment

### Important Notes

- The webhook URL must be publicly accessible from Supabase's database server
- The API route `/api/public/hooks/competitor-watch` must accept unauthenticated POST requests
- Ensure the `CRON_SECRET` environment variable on your server matches the auth mechanism in the webhook
- Test the webhook manually: `curl -X POST "https://your-domain.com/api/public/hooks/competitor-watch" -H "Content-Type: application/json" -d '{}'`

## ✅ Application-Level URL Configuration

The application now uses the `APP_URL` environment variable for all dynamic URL generation:

- **Development**: Set `APP_URL=http://localhost:8080` (the port `npm run dev` uses)
- **Staging**: Set `APP_URL=https://staging.your-domain.com`
- **Production**: Set `APP_URL=https://your-domain.com`

This controls:

- SEO meta tags (og:url, canonical)
- JSON-LD structured data
- Favicon and logo paths
- Validation script canonical hosts

`NEXT_PUBLIC_APP_URL` must be set to the same value. It is inlined at build
time, so on Railway it has to exist as a build variable (see the `ARG` lines in
the `Dockerfile`), not only at runtime.

## Integration Checklist

- [ ] Confirm production domain name
- [ ] Update database cron webhook URL via Supabase SQL Editor
- [ ] Set `APP_URL` in the Railway service variables
- [ ] Set `NEXT_PUBLIC_APP_URL` to the same value as a **build** variable
- [ ] Set `CRON_SECRET` (min 16 chars) — the hooks return 503 without it
- [ ] Test SEO meta tags: `curl https://your-domain.com/ | grep 'og:url'`
- [ ] Test competitor watch webhook (expect 401 without the secret):
      `curl -X POST https://your-domain.com/api/public/hooks/competitor-watch`
- [ ] Run validation scripts: `APP_URL=https://your-domain.com npm run test:sitemap`

## Related Documentation

- [Codebase Analysis](./docs/CODEBASE-ANALYSIS-2026-09-11.md)
- [Team Credentials](./docs/TEAM-CREDENTIALS.md)
- [Environment Variables Guide](./.env.example)
- [Google OAuth Setup](./docs/GOOGLE-OAUTH-SETUP.md)
