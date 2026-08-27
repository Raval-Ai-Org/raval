# RavalAI SDE — Operational Runbook

## Quick Reference

| Service | Port | Health Check |
|---------|------|-------------|
| API | 8000 | `GET /healthz` |
| PostgreSQL | 5432 | `pg_isready` |
| Redis | 6379 | `redis-cli ping` |
| Celery Worker | — | `celery -A app.celery_app inspect ping` |
| Celery Beat | — | Check process is running |
| Flower | 5555 | `GET http://localhost:5555` |

---

## Common Operations

### Start the stack
```bash
docker-compose up -d
```

### Stop the stack
```bash
docker-compose down
```

### View logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f beat
```

### Run database migrations
```bash
docker exec raval-sde-api alembic upgrade head
```

### Create new migration
```bash
docker exec raval-sde-api alembic revision --autogenerate -m "description"
docker exec raval-sde-api alembic upgrade head
```

### Reset database (DANGER)
```bash
docker-compose down
docker volume rm raval-ai_postgres_data
docker-compose up -d
docker exec raval-sde-api alembic upgrade head
```

---

## Troubleshooting

### API not responding
1. Check `docker-compose ps` — is the API container running?
2. Check logs: `docker-compose logs api`
3. Check database connection: `curl http://localhost:8000/healthz`
4. If database unhealthy: `docker-compose logs postgres`

### Celery worker not processing tasks
1. Check worker is running: `docker-compose ps worker`
2. Check worker logs: `docker-compose logs worker`
3. Check Redis is running: `redis-cli -h localhost ping`
4. Ping workers: `docker exec raval-sde-api celery -A app.celery_app inspect ping`

### Authentication failures (401)
1. Verify API token: check `SDE_API_TOKEN` in `.env`
2. Ensure `Authorization: Bearer <token>` header format
3. Token must be ≥16 characters

### Posts stuck in "pending" status
1. Check beat is running: `docker-compose logs beat`
2. Check worker is claiming tasks: `docker-compose logs worker`
3. Manually trigger: `docker exec raval-sde-api celery -A app.celery_app call scheduler.tick_due_jobs`

### Rate limit errors (429)
1. Check platform rate limits (Twitter: 15 tweets/15min, LinkedIn: 100/day)
2. Wait for Retry-After period
3. Consider reducing publish frequency

### Database connection pool exhaustion
1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Kill idle connections: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND query_start < now() - interval '5 minutes';`
3. Restart API: `docker-compose restart api`

---

## Monitoring

### Health Check
```bash
curl http://localhost:8000/healthz | python -m json.tool
```

### Database stats
```sql
-- Active posts by status
SELECT status, count(*) FROM posts GROUP BY status;

-- Target delivery status
SELECT status, count(*) FROM post_targets GROUP BY status;

-- Recent failures
SELECT pt.id, pt.error_category, pt.last_error, dl.created_at
FROM post_targets pt
JOIN delivery_logs dl ON dl.post_target_id = pt.id
WHERE pt.status = 'failed'
ORDER BY dl.created_at DESC LIMIT 10;
```

### Redis queue depth
```bash
redis-cli LLEN celery
```

---

## Scaling

### Adding workers
```bash
docker-compose up -d --scale worker=3
```

### Increasing beat frequency
Set `BEAT_INTERVAL_SECONDS` in `.env` (default: 30).

### Database connection pool
Adjust `DB_POOL_SIZE` and `DB_MAX_OVERFLOW` in `.env`.

---

## Emergency Procedures

### Cancel all pending posts
```sql
UPDATE posts SET status = 'cancelled' WHERE status = 'pending';
UPDATE post_targets SET status = 'cancelled' WHERE status = 'pending';
```

### Disable all webhooks
```sql
UPDATE webhook_endpoints SET status = 'disabled';
```

### Force token refresh
```bash
docker exec raval-sde-api celery -A app.celery_app call scheduler.refresh_tokens
```
