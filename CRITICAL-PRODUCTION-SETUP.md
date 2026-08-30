# CRITICAL PRODUCTION SETUP REQUIREMENTS

## ⚠️ Database Webhook URL Migration

The pg_cron scheduler in the database migration `supabase/migrations/20260709194553_bb8d43fe-2f5e-48cb-9c77-8042cb96e8be.sql` contains a hardcoded webhook URL pointing to the development/staging domain:

```sql
url := 'https://raval6.lovable.app/api/public/hooks/competitor-watch'
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

- **Development**: Set `APP_URL=http://localhost:5173` (or your dev port)
- **Staging**: Set `APP_URL=https://staging.your-domain.com`
- **Production**: Set `APP_URL=https://your-domain.com`

This controls:

- SEO meta tags (og:url, canonical)
- JSON-LD structured data
- Favicon and logo paths
- Validation script canonical hosts

## Integration Checklist

- [ ] Confirm production domain name
- [ ] Update database cron webhook URL via Supabase SQL Editor
- [ ] Set `APP_URL` environment variable in deployment platform (Vercel, Cloudflare Workers, etc.)
- [ ] Verify `VITE_APP_URL` is set to same value (or browser will auto-detect)
- [ ] Test SEO meta tags: `curl https://your-domain.com/ | grep 'og:url'`
- [ ] Test competitor watch webhook: `curl -X POST https://your-domain.com/api/public/hooks/competitor-watch`
- [ ] Run validation scripts: `APP_URL=https://your-domain.com npm run validate:sitemap`

## Related Documentation

- [Authentication Reset Details](./AUTHENTICATION-RESET-DETAILS.md)
- [Environment Variables Guide](./.env.example)
- [Supabase Setup Instructions](./docs/SUPABASE-AUTH-SETUP.md)
