# ADR-0005: AWS Lightsail Production Deployment for SDR Service

**Date**: 2026-08-13  
**Status**: In Progress (Deployment Active, Cloudflare Tunnel Pending)  
**Deciders**: Muhammad-Junaid-Sajjad  
**Context**: T080 - Deploy SDR backend service to production cloud hosting

---

## Context and Problem Statement

The Social Distribution Engine (SDR) backend service needs to be deployed to production cloud infrastructure to enable the RavalAI platform (deployed on Vercel at `https://raval.it.com`) to publish social media posts on behalf of clients. The SDR consists of 5 Docker containers (FastAPI API, Celery worker, Celery beat, PostgreSQL, Redis) requiring minimum 2 GB RAM and 24/7 uptime with public HTTPS access.

**Key Requirements:**

- Public internet access with HTTPS for API calls from Vercel
- Webhook reception from social platforms (LinkedIn, X, Facebook, Instagram)
- Minimum 2 GB RAM (measured: 1.5 GB idle, 2 GB under load)
- 24/7 reliability
- Budget: prefer <$15/month

---

## Decision Drivers

1. **Oracle Cloud Always Free failed** (billing verification failed twice, money charged but account never activated)
2. **AWS EC2 Free Tier insufficient** (t2.micro/t3.micro = 1 GB RAM, need 2 GB minimum)
3. **User familiarity with AWS** (comfortable with AWS interface vs learning new providers)
4. **IPv4 webhook requirement** (social platforms likely use IPv4 for delivery callbacks - critical for US4 user story)
5. **Immediate deployment need** (production launch targeted end of September 2026)

---

## Considered Options

### Option 1: Oracle Cloud Always Free ❌ REJECTED

- **Specs**: 4 OCPUs + 24 GB RAM (Ampere A1)
- **Cost**: $0 forever
- **Verdict**: Billing verification failed twice, unreliable activation, lost money

### Option 2: AWS EC2 Free Tier (t2.micro/t3.micro) ❌ REJECTED

- **Specs**: 1 vCPU + 1 GB RAM
- **Cost**: $0 for 12 months
- **Verdict**: Insufficient RAM (containers will crash)

### Option 3: Hetzner Cloud CPX21 ⚠️ CONSIDERED

- **Specs**: 3 vCPU + 4 GB RAM + 80 GB SSD
- **Cost**: €4.15/month (~$4.50 USD)
- **Verdict**: Cheapest viable option, but new platform (unfamiliar)

### Option 4: DigitalOcean Basic Droplet ⚠️ CONSIDERED

- **Specs**: 2 vCPU + 4 GB RAM + 80 GB SSD
- **Cost**: $0 for 60 days ($200 credit), then $24/month
- **Verdict**: Free trial attractive, but expensive after trial

### Option 5: AWS Lightsail $12/month Dual-stack ✅ SELECTED

- **Specs**: 2 vCPU + 2 GB RAM + 60 GB SSD + 3 TB transfer
- **Cost**: $12/month (Dual-stack networking)
- **Verdict**: Balance of familiarity, functionality, and acceptable cost

---

## Decision Outcome

**Chosen option**: AWS Lightsail $12/month Dual-stack plan

**Rationale:**

- **Minimum viable RAM**: 2 GB meets requirement (measured 1.5 GB idle, 2 GB under load)
- **IPv4 + IPv6 dual-stack**: Ensures social platform webhooks (likely IPv4) can reach server
- **AWS familiarity**: User already knows AWS interface, reduces operational risk
- **Instant activation**: Account ready, no billing verification delays
- **Flat predictable pricing**: $12/month vs AWS EC2 variable costs
- **Production reliability over cost**: $12/month vs $4.50 Hetzner - chose reliability and familiarity for production workload

**Alternative rejected**: IPv6-only plan ($10/month) - $2 savings not worth risk of webhook delivery failures

---

## Deployment Details

### **Server Specifications**

- **Provider**: AWS Lightsail
- **Region**: Singapore (ap-southeast-1a)
- **Plan**: $12/month Dual-stack
- **OS**: Ubuntu 24.04 LTS
- **Resources**: 2 vCPU, 2 GB RAM, 60 GB SSD, 3 TB transfer/month
- **Networking**: Dual-stack (IPv4 + IPv6)

### **Network Configuration**

- **Public IPv4**: `47.129.3.69`
- **Private IPv4**: `172.26.11.222`
- **Public IPv6**: `2406:da18:1c72:9200:295c:4b4d:c5ad:558b`
- **SSH Access**: LightsailDefaultKey (downloaded)
- **Firewall**: SSH (22), HTTP (80), HTTPS (443)

### **Installation Completed**

```bash
# System
Ubuntu 24.04 LTS (updated 2026-08-13)
Docker Engine 29.7.2
Docker Compose v5.4.0

# Repository
GitHub: Muhammad-Junaid-Sajjad/Social-Distribtion-Engine-RavalAI-SDE- (private)
Cloned: 13,205 files, 94.23 MB
Location: /home/ubuntu/sdr/
```

---

## Production Secrets (CRITICAL - STORE SECURELY)

**⚠️ THESE SECRETS ARE PRODUCTION CREDENTIALS - DO NOT COMMIT TO GIT**

### **Database Credentials**

```bash
POSTGRES_HOST=postgres
POSTGRES_DB=raval_sde
POSTGRES_USER=sde
POSTGRES_PASSWORD=87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e
```

### **SDR API Security**

```bash
# MUST match Vercel's SDR_ADMIN_TOKEN exactly
SDE_API_TOKEN=2d6f0f80867966cf0133407a2b2145501f934758a7eeb4e8

# Webhook signature verification
SDE_SIGNING_SECRET=6b100fe03b49406b84cc8869358ceb91117d8c79fc32e7dece428264ed716bfe

# Encryption key (for encrypting OAuth tokens in database)
FERNET_KEY=0yIvrQov4QCE9bAErwq8LhF4rjA6TRtJ8XjSR5_ydD8=
```

### **Database Connection Strings**

```bash
DATABASE_URL=postgresql://sde:87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e@postgres:5432/raval_sde
DATABASE_URL_SYNC=postgresql+psycopg://sde:87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e@postgres:5432/raval_sde
```

### **GitHub Access**

```bash
# Personal Access Token (for private repo access)
PAT=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
```

### **Full Production .env**

Location: `/home/ubuntu/sdr/.env`

```env
# Environment
ENV=production

# Database
POSTGRES_HOST=postgres
POSTGRES_DB=raval_sde
POSTGRES_USER=sde
POSTGRES_PASSWORD=87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e

# Redis
REDIS_URL=redis://redis:6379/0

# SDR API Security
SDE_API_TOKEN=2d6f0f80867966cf0133407a2b2145501f934758a7eeb4e8
SDE_SIGNING_SECRET=6b100fe03b49406b84cc8869358ceb91117d8c79fc32e7dece428264ed716bfe

# CORS
CORS_ORIGINS=https://raval.it.com

# Logging
LOG_LEVEL=INFO

# Database URLs (for Celery worker)
DATABASE_URL=postgresql://sde:87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e@postgres:5432/raval_sde
DATABASE_URL_SYNC=postgresql+psycopg://sde:87589f0a1984551c93455d448091586642f4b069ac7b3d2a51f62fb858c59a3e@postgres:5432/raval_sde

# Encryption
FERNET_KEY=0yIvrQov4QCE9bAErwq8LhF4rjA6TRtJ8XjSR5_ydD8=
```

---

## Deployment Status (as of 2026-08-13 13:34 UTC)

### **✅ Completed**

1. AWS Lightsail instance provisioned (47.129.3.69)
2. Ubuntu 24.04 LTS installed and updated
3. Docker Engine 29.7.2 + Docker Compose v5.4.0 installed
4. SDR repository cloned (13,205 files)
5. Production secrets generated (POSTGRES_PASSWORD, SDE_SIGNING_SECRET, FERNET_KEY)
6. Production `.env` file created
7. Docker containers built and deployed (5 containers)
8. Database migrations applied (3 migrations: 001_initial_schema, 002_add_api_keys, 003_delivery_logs_post_id_nullable)
9. Health check passing: `http://localhost:8000/healthz` returns healthy

### **Container Status**

```bash
NAME                 STATUS                  PORTS
raval-sde-api        Up 8 minutes (healthy)  0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp
raval-sde-postgres   Up 9 minutes (healthy)  0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp
raval-sde-redis      Up 9 minutes (healthy)  0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp
raval-sde-beat       Up 8 minutes (unhealthy) - but functioning (sending scheduled tasks)
raval-sde-worker     Up 8 minutes (unhealthy) - but functioning (processing tasks)
```

**Note**: Beat and Worker show "unhealthy" status but logs confirm they ARE working:

- Beat: Sending scheduled tasks every 30 seconds (`tick-due-jobs`)
- Worker: Processing tasks successfully (`Task scheduler.tick_due_jobs[...] succeeded`)

### **Health Check Response**

```json
{
  "status": "healthy",
  "timestamp": "2026-08-13T13:12:43.280845Z",
  "services": {
    "database": true,
    "redis": true,
    "workers": true
  },
  "details": null
}
```

---

## ⏸️ Pending Tasks (Paused for Documentation)

### **Immediate Next Steps (T080 continuation)**

1. **Install Cloudflared** ✅ (completed: version 2026.8.0 installed)
2. **Authenticate with Cloudflare** (pending: `cloudflared tunnel login`)
3. **Create Cloudflare Tunnel** (pending: `cloudflared tunnel create raval-sdr-test`)
4. **Configure tunnel routing** (pending: map subdomain to localhost:8000)
5. **Route DNS** (pending: add CNAME record)
6. **Start tunnel as systemd service** (pending: enable auto-start)
7. **Verify HTTPS access** (pending: test `https://sdr-test.raval.it.com/healthz`)

### **Subdomain Decision (CRITICAL)**

**⚠️ IMPORTANT SAFETY CONSIDERATION:**

User raised critical concern: The real production site (`raval.it.com`) is **ALREADY LIVE with REAL CLIENTS**. This deployment is a **COPY/TEST environment**.

**Two options identified:**

**Option A: Use test subdomain** (RECOMMENDED for safety)

- `sdr-test.raval.it.com` or `sdr-staging.raval.it.com`
- Zero risk to real production
- Clear separation (test vs production)
- Can test safely without affecting real clients

**Option B: Use production subdomain**

- `sdr.raval.it.com`
- Only if real production is NOT using SDR yet
- Requires confirmation that Supabase databases are separate

**Decision**: User paused to document before making final subdomain choice.

### **After Tunnel Setup**

1. Update Vercel environment variable: `SDR_BASE_URL` from `http://localhost:8000` to `https://sdr-test.raval.it.com` (or chosen subdomain)
2. Redeploy Vercel to pick up new SDR_BASE_URL
3. Test integration: RavalAI production → deployed SDR
4. Verify webhooks: LinkedIn/X/Facebook/Instagram → SDR delivery callbacks

### **Subsequent Tasks (T081-T083)**

- **T081**: Update OAuth redirect URIs on all platforms to production SDR URL
- **T081**: Initiate Meta App Review for Facebook/Instagram publish permissions
- **T082**: Implement workspace SDR key rotation feature
- **T083**: Run full E2E testing against production SDR
- **T083**: Make go/no-go decision to flip `FEATURE_FLAG_SDR_ENABLED=true`

---

## Architectural Decisions

### **1. Dual-stack vs IPv6-only Networking**

**Decision**: Dual-stack (+$2/month premium)

**Rationale**: Social media platform webhooks (LinkedIn, X, Facebook, Instagram) likely require IPv4 for delivery status callbacks. This is critical for US4 user story (users see delivery status). The $2/month premium is production reliability insurance - webhook delivery failures would be catastrophic for user experience.

**Trade-off**: $12/month vs $10/month - chose reliability over cost savings.

### **2. AWS Lightsail vs Hetzner Cloud**

**Decision**: AWS Lightsail ($12/month)

**Rationale**:

- User familiarity with AWS reduces operational risk
- Instant activation (no learning curve)
- Production workload prioritizes reliability over cost
- $7.50/month premium ($12 vs $4.50) buys operational confidence

**Trade-off**: 2 GB RAM vs 4 GB RAM (Hetzner) - accepted tighter margins for familiarity.

### **3. Production Deployment Philosophy**

**Decision**: Production reliability over cost savings

**Rationale**:

- Launch is end of next month (September 2026)
- Quality bar = production perfection
- Correctness, security, completeness beat velocity
- $12/month is acceptable for business-critical service

### **4. Subdomain Safety Strategy**

**Decision**: Paused for user confirmation (test vs production subdomain)

**Rationale**: User raised critical concern about real production site already running with real clients. Must ensure test deployment does not interfere with live business operations. Recommending `sdr-test.raval.it.com` for isolation unless confirmed that production is not using SDR yet.

---

## Consequences

### **Positive**

- ✅ SDR service successfully deployed to production infrastructure
- ✅ All 5 containers operational (API, worker, beat, PostgreSQL, Redis)
- ✅ Health checks passing, tasks processing correctly
- ✅ Database migrations applied successfully
- ✅ Production secrets generated and documented
- ✅ IPv4 + IPv6 dual-stack ensures webhook compatibility
- ✅ AWS familiarity reduces operational risk
- ✅ Cloudflared installed, ready for HTTPS tunnel setup

### **Negative**

- ⚠️ $12/month recurring cost (vs $0 Oracle or $4.50 Hetzner)
- ⚠️ Only 2 GB RAM (minimal headroom, no buffer for traffic spikes)
- ⚠️ Subdomain decision pending (test vs production isolation concern)
- ⚠️ Beat/Worker containers show "unhealthy" status (cosmetic issue, functioning correctly)

### **Neutral**

- Cloudflare Tunnel setup still required (blocked on subdomain decision)
- Vercel configuration update pending (depends on final SDR URL)
- T081-T083 tasks deferred until tunnel operational

---

## Monitoring and Maintenance

### **Health Checks**

```bash
# API health
curl http://localhost:8000/healthz

# Container status
docker compose ps

# Container logs
docker compose logs api --tail=50
docker compose logs worker --tail=50
docker compose logs beat --tail=50
```

### **Database Access**

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U sde -d raval_sde

# List tables
docker compose exec postgres psql -U sde -d raval_sde -c "\dt"
```

### **System Resources**

```bash
# Memory usage
free -h

# Disk usage
df -h

# Docker resource usage
docker stats
```

### **Service Management**

```bash
# Restart all containers
docker compose restart

# View container logs
docker compose logs -f

# Stop all containers
docker compose down

# Start all containers
docker compose up -d
```

---

## Links and References

- **T080 Task**: Deploy SDR backend to production cloud hosting
- **ADR-0003**: Deployment topology (local-first Oracle tunnel) - superseded by this AWS deployment
- **AWS Lightsail Console**: https://lightsail.aws.amazon.com/
- **Server SSH**: `ssh -i LightsailDefaultKey ubuntu@47.129.3.69`
- **Deployment Guide**: `/home/nauman_sajjad/Desktop/project-alpa/AWS-LIGHTSAIL-DEPLOYMENT-STEPS.md`
- **Oracle Analysis**: `/home/nauman_sajjad/Desktop/project-alpa/T080-COMPLETE-DEPLOYMENT-GUIDE-2026.md`
- **AWS Analysis**: `/home/nauman_sajjad/Desktop/project-alpa/AWS-ANALYSIS-FOR-SDR.md`

---

## Timeline

- **2026-08-13 19:00 PKT**: Oracle Cloud billing verification failed (second attempt)
- **2026-08-13 19:15 PKT**: Decision to abandon Oracle, evaluate AWS alternatives
- **2026-08-13 19:30 PKT**: AWS Lightsail selected, instance provisioned
- **2026-08-13 19:45 PKT**: SSH access configured, system updated
- **2026-08-13 20:00 PKT**: Docker installed, SDR repository cloned
- **2026-08-13 20:30 PKT**: Production secrets generated, .env created
- **2026-08-13 20:45 PKT**: Docker containers deployed
- **2026-08-13 21:00 PKT**: FERNET_KEY issue discovered and resolved by user
- **2026-08-13 21:10 PKT**: Database migrations applied successfully
- **2026-08-13 21:15 PKT**: Health checks passing, all services operational
- **2026-08-13 21:22 PKT**: Cloudflared 2026.8.0 installed
- **2026-08-13 21:34 PKT**: **PAUSED** - User requested documentation before proceeding with Cloudflare Tunnel

---

## Next Session Resume Point

**Status**: SDR fully operational on AWS Lightsail at `http://localhost:8000`, Cloudflared installed, ready for tunnel authentication.

**To resume**:

1. Confirm subdomain choice: `sdr-test.raval.it.com` (safe) or `sdr.raval.it.com` (production)
2. Run: `cloudflared tunnel login` (authenticate via browser)
3. Continue with Cloudflare Tunnel setup (ADR AWS-LIGHTSAIL-DEPLOYMENT-STEPS.md Step 8.2+)
4. Update Vercel `SDR_BASE_URL` after tunnel operational
5. Test integration and proceed to T081-T083

**Critical reminder**: SDE_API_TOKEN (`2d6f0f80867966cf0133407a2b2145501f934758a7eeb4e8`) MUST match Vercel's `SDR_ADMIN_TOKEN` exactly.

---

**Document Status**: Complete and ready for reference in future sessions.
