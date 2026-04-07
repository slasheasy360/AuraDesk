# AuraDesk — Infrastructure & Deployment Plan

**Version:** 2.0  
**Prepared by:** Slasheasy  
**Document scope:** AWS architecture, ECS Fargate setup, CI/CD pipeline, branch strategy, versioning, SES email service, dev/test vs production config, and Kundan's manual setup guide

---

## 1. Overview

AuraDesk is deployed on Amazon Web Services using ECS Fargate as the compute layer. There are no EC2 instances to manage. The application runs as Docker containers orchestrated by AWS ECS.

The infrastructure follows a **two-phase approach**:

- **Phase 1 — Dev/Test (now):** Lean, low-cost setup. ECS Fargate for backend services, CloudFront + S3 for frontend, RDS PostgreSQL for the database. No ALB, no Redis, no NAT Gateways, no WAF. Tasks run with public IPs directly. Cost: ~$35–45/month.
- **Phase 2 — Production (at stable release):** Full production-grade stack. All Phase 1 components plus ALB, ElastiCache Redis, NAT Gateways, WAF, Multi-AZ RDS, read replica, CloudWatch alarms. Cost: ~$215/month.

### Key decisions locked in

| Decision | Choice | Reason |
|---|---|---|
| Compute | ECS Fargate | No server management, per-service scaling, pay per use |
| Environments | Test + Production | Test for QA, Prod for live users |
| Provisioning | Manual AWS Console | Kundan sets up, guided by this document |
| Repo structure | Monorepo | 3 Dockerfiles in one GitHub repository |
| App state | Stateless | Sessions in Redis (prod) or memory (dev), files in S3 |
| Secrets | AWS Secrets Manager | No .env files in containers — ever |
| CI/CD | GitHub Actions | Build Docker image → push ECR → ECS rolling deploy |
| Versioning | Semantic MAJOR.MINOR.PATCH | Auto-tagged on every successful production deploy |
| Email | AWS SES | Transactional email for all AuraDesk notifications |
| Frontend | CloudFront + S3 | CDN-served React build in both environments |

---

## 2. Team & Roles

| Person | Role | Responsibility |
|---|---|---|
| Yash | Developer | Writes code, develops locally, pushes to developer branch |
| Jitendra | Code Reviewer | Reviews all PRs before merge to test branch |
| Krupa | QA Tester | Tests on test environment, signs off before production |
| Kundan | DevOps | Sets up and maintains all AWS infrastructure (manual console) |
| Mehul | Product Owner | Approves test → main PR, final production gate |

---

## 3. Branch Strategy

Three permanent branches. No direct pushes to test or main — pull requests only.

```
developer  →  test  →  main
```

### Branch rules

**developer branch**
- Yash develops and tests on local machine only
- Raises PR to test branch when a feature is complete
- Jitendra reviews code — approval required before merge is allowed
- GitHub Actions runs automatically: install → lint → build → unit tests
- On pass: auto-deploys to Test environment

**test branch**
- Krupa runs full QA on test.yourdomain.com
- Bugs logged in ClickUp → Yash fixes on developer → loop repeats
- When Krupa signs off: Mehul raises PR from test → main
- Mehul reviews and approves — only then merge happens

**main branch**
- Production only — no exceptions
- GitHub Actions re-runs full build + test suite as a final safety check
- On pass: auto-deploys to Production environment
- Auto-creates git tag and GitHub Release with changelog

### GitHub branch protection rules

| Rule | developer | test | main |
|---|---|---|---|
| Direct push allowed | Yes (Yash only) | No — PR only | No — PR only |
| Reviewer approval required | No | Jitendra | Mehul |
| GitHub Actions must pass | No | Yes | Yes |
| Branch deletions allowed | No | No | No |

---

## 4. Versioning Strategy

Semantic versioning: `MAJOR.MINOR.PATCH` — auto-applied on every production deploy.

| Type | When it increments | Example |
|---|---|---|
| MAJOR | Milestone go-live deployed to production | v1.0.0 (M1), v2.0.0 (M2), v3.0.0 (M3) |
| MINOR | Feature merged to main | v1.1.0, v1.2.0 |
| PATCH | Bug fix merged to main | v1.1.1, v1.2.1 |

### AuraDesk version roadmap

```
v0.1.0  — Initial scaffold and repo setup
v0.x.x  — During Milestone 1 build
v1.0.0  — Milestone 1 approved and live (Foundation, Inbox, AI)
v1.x.x  — During Milestone 2 build
v2.0.0  — Milestone 2 approved and live (Leads, Knowledge Base)
v2.x.x  — During Milestone 3 build
v3.0.0  — Milestone 3 approved and live (Invoices, Payments)
v3.x.x  — Post-launch patches and improvements
```

### How auto-tagging works

Every successful deploy to production via GitHub Actions automatically:
1. Creates a git tag (e.g. `v1.2.0`) on the main branch
2. Pushes the tag to the GitHub repository
3. Creates a GitHub Release with auto-generated release notes
4. Tags only exist on main — developer and test branches are never tagged

---

## 5. Application Architecture Requirements

### 5.1 Stateless containers — critical for Fargate

ECS Fargate containers do not persist local disk state between restarts. The application must follow these rules from day one:

- All file uploads go directly to S3 — no local disk writes for user files
- All configuration read from environment variables at startup — no `.env` files baked into the image
- Safe to run multiple identical copies simultaneously — no singleton assumptions
- Sessions: in-memory store in dev/test (acceptable, loses sessions on restart), Redis in production (required for multi-task scaling)

Make the session store configurable via environment variable:

```
SESSION_DRIVER=memory   # dev/test
SESSION_DRIVER=redis    # production
```

### 5.2 Monorepo structure

```
auradesk/
├── apps/
│   ├── api/                  # Node.js Express API
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   ├── webhook/              # Meta + Gmail webhook handler
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   └── worker/               # SQS background jobs + AI replies
│       ├── src/
│       ├── package.json
│       └── Dockerfile
├── packages/
│   └── shared/               # Shared utilities, Prisma schema
├── frontend/                 # React + Vite frontend
│   ├── src/
│   └── package.json
├── .github/
│   └── workflows/
│       ├── deploy-test.yml
│       └── deploy-prod.yml
├── docker-compose.yml        # Local development only
└── package.json              # Root workspace config
```

### 5.3 Three Fargate services

| Service | Handles | Port | Scales on |
|---|---|---|---|
| API | Auth, inbox, leads, invoices, AI replies — all business logic | 3000 | CPU > 60% |
| Webhook | Inbound Meta (WA, FB, IG) and Gmail Pub/Sub webhooks | 3001 | Request count |
| Worker | SQS job processing — AI generation, emails, reminders | None | SQS queue depth |

---

## 6. Phase 1 — Dev/Test Environment (Current)

### 6.1 What is included

| Component | Spec | Purpose |
|---|---|---|
| ECS Fargate — API | 1 task · 0.5 vCPU · 1 GB · public IP | Business logic |
| ECS Fargate — Webhook | 1 task · 0.25 vCPU · 0.5 GB · public IP | Inbound webhooks |
| ECS Fargate — Worker | 1 task · 0.5 vCPU · 1 GB · public IP | Async jobs + AI |
| RDS PostgreSQL | db.t3.micro · Single AZ · 20 GB gp3 | Database |
| S3 — files bucket | auradesk-test-files | Uploads, KB docs |
| S3 — static bucket | auradesk-test-static | React build |
| CloudFront | Serves React build from S3 | Frontend CDN |
| SQS | Standard queue — auradesk-test-jobs | Async job queue |
| SES | Sandbox mode (verified addresses only) | Email sending |
| Secrets Manager | auradesk/test/config | All credentials |
| ECR | 3 repositories (api, webhook, worker) | Docker images |
| CloudWatch | Log groups only — 30 day retention | Logs |
| Route 53 + ACM | test.yourdomain.com · SSL cert | Domain + HTTPS |

### 6.2 What is NOT included in dev/test

| Component | Why excluded | Monthly saving |
|---|---|---|
| Application Load Balancer | Fargate tasks have public IPs — traffic reaches containers directly | ~$18 |
| ElastiCache Redis | Sessions use in-memory store — acceptable for dev/test | ~$25 |
| NAT Gateway | Not needed — tasks have public IPs for outbound API calls | ~$64 |
| WAF | Not needed during development | ~$10 |
| Multi-AZ RDS | Single AZ is fine — no production data at risk | ~$15 |
| RDS Read Replica | Not needed at dev scale | ~$25 |
| Private/isolated subnets | Simple public subnet only | ~$0 |
| **Total saving** | | **~$157/month** |

### 6.3 Dev/test traffic flow

```
Internet
  ↓
CloudFront (React frontend from S3)
  ↓
Route 53 → test.yourdomain.com
  ↓
ECS Fargate tasks (public subnet, public IP assigned)
  API task      → :3000  direct traffic
  Webhook task  → :3001  Meta + Gmail webhooks
  Worker task   → polls SQS internally
  ↓
RDS PostgreSQL (isolated subnet)
SQS, S3, SES (managed AWS services)
```

### 6.4 Dev/test VPC layout

```
VPC: 10.0.0.0/16

Public subnets (ECS tasks run here with public IPs)
  AZ-A: 10.0.1.0/24
  AZ-B: 10.0.2.0/24

Isolated subnets (RDS only — no internet routing)
  AZ-A: 10.0.5.0/24
  AZ-B: 10.0.6.0/24
```

### 6.5 Dev/test security groups

**ECS Security Group** (`auradesk-test-ecs-sg`)
- Inbound: HTTPS 443, HTTP 80, TCP 3000, TCP 3001 — all from 0.0.0.0/0
- Outbound: All traffic (calls OpenAI, Stripe, Meta APIs outbound)

**RDS Security Group** (`auradesk-test-rds-sg`)
- Inbound: PostgreSQL 5432 from `auradesk-test-ecs-sg` only
- Outbound: None

### 6.6 Dev/test monthly cost estimate

| Service | Spec | Est. cost/month |
|---|---|---|
| ECS Fargate — 3 tasks | 1.25 vCPU total | ~$12–18 |
| RDS PostgreSQL | db.t3.micro · Single AZ | ~$15 |
| S3 + CloudFront | Files + frontend | ~$2–3 |
| SQS | Standard queue | ~$0–1 |
| SES | Sandbox — minimal volume | ~$0–1 |
| Route 53 + ACM | Hosted zone + SSL | ~$1 |
| ECR | 3 repositories | ~$1–2 |
| CloudWatch | Log groups only | ~$2–3 |
| Secrets Manager | ~10 secrets | ~$1 |
| **Total** | | **~$35–45/month** |

---

## 7. Phase 2 — Production Environment (At Stable Release)

### 7.1 Components added on top of dev/test

| Component | Spec | Why needed | Cost added |
|---|---|---|---|
| VPC (3 subnet tiers) | Public + private + isolated across 2 AZs | Tasks move to private subnet — not internet-facing | ~$0 |
| NAT Gateway | 1 per AZ | ECS private subnet tasks need outbound for external APIs | +$64/mo |
| ElastiCache Redis | cache.t3.micro + 1 replica | Sessions, quota — required when multiple tasks run | +$25/mo |
| Application Load Balancer | Path-based routing | Routes /api/* and /webhooks/* — SSL termination | +$18/mo |
| WAF | Attached to ALB | Blocks malicious traffic, bot protection, rate limiting | +$10/mo |
| RDS upgrade | db.t3.medium + Multi-AZ | 300 connections, automatic failover to standby | +$35/mo |
| RDS read replica | db.t3.micro | Offloads inbox and lead read queries from primary | +$25/mo |
| CloudWatch alarms | 6 alarms + SNS | Proactive alerts before issues become outages | +$5/mo |
| SES production access | Request via AWS console | Send emails to real client addresses | ~$0 |
| **Total added** | | | **~$182/mo** |

### 7.2 Production VPC layout

```
VPC: 10.1.0.0/16

Public subnets (ALB only — nothing else lives here)
  AZ-A: 10.1.1.0/24
  AZ-B: 10.1.2.0/24

Private subnets (ECS Fargate tasks — no public IP)
  AZ-A: 10.1.3.0/24
  AZ-B: 10.1.4.0/24

Isolated subnets (RDS + Redis — zero internet routing)
  AZ-A: 10.1.5.0/24
  AZ-B: 10.1.6.0/24
```

### 7.3 Production traffic flow

```
Internet
  ↓
Internet Gateway
  ↓
WAF (blocks malicious traffic before it reaches ALB)
  ↓
CloudFront (React frontend served from S3 edge locations)
  ↓
ALB — Application Load Balancer (public subnet)
  /api/*       → API Fargate tasks (private subnet)
  /webhooks/*  → Webhook Fargate tasks (private subnet)
  ↓
ECS Fargate tasks (private subnet — no public IP assigned)
  ↓
RDS PostgreSQL + ElastiCache Redis (isolated subnet)

ECS tasks → NAT Gateway → Internet (outbound: OpenAI, Stripe, Meta APIs, SES)
```

### 7.4 Production security group chain of trust

| Resource | Accepts inbound from | Effect |
|---|---|---|
| ALB | 0.0.0.0/0 on port 443 | Single public entry point into the system |
| ECS tasks | ALB security group only | Cannot be reached directly from the internet |
| RDS | ECS security group on port 5432 | Only app containers can reach the database |
| ElastiCache | ECS security group on port 6379 | Only app containers can reach the cache |

### 7.5 Production ECS task sizes and autoscaling

| Service | vCPU | Memory | Min tasks | Max tasks | Scale trigger |
|---|---|---|---|---|---|
| API | 0.5 | 1 GB | 1 | 10 | CPU > 60% |
| Webhook | 0.25 | 0.5 GB | 1 | 4 | Request count |
| Worker | 0.5 | 1 GB | 1 | 6 | SQS queue depth > 10 |

### 7.6 Full production AWS services reference

| Service | Purpose | Spec |
|---|---|---|
| ECS Fargate | Container compute — 3 services | Per-task vCPU + memory billing |
| ECR | Docker image registry | 6 repos (3 services × 2 environments) |
| ALB | Load balancing + path-based routing | 1 per environment |
| RDS PostgreSQL | Primary database | db.t3.medium + Multi-AZ + read replica |
| ElastiCache Redis | Sessions, quota tracking, caching | cache.t3.micro + 1 replica |
| S3 | File uploads + static React frontend | 2 buckets per environment |
| SQS | Async job queue | Standard queue + dead-letter queue |
| CloudFront | CDN for React frontend | Global edge locations |
| Route 53 | DNS routing | Hosted zone |
| ACM | SSL/TLS certificates | Free with AWS |
| WAF | Web application firewall | Attached to ALB |
| Secrets Manager | All API keys and credentials | Per secret/month billing |
| CloudWatch | Logs, metrics, and alarms | Per log group + metrics |
| SES | Transactional email | Production access required before go-live |
| SNS | Alert notifications to Mehul | Per alarm |
| NAT Gateway | Outbound internet for ECS private tasks | 1 per AZ |

---

## 8. AWS SES — Email Service

AuraDesk uses AWS SES for all transactional email. Cost is $0.10 per 1,000 emails — the cheapest option at this scale and native to the AWS stack.

### 8.1 SES sandbox vs production — critical difference

| Constraint | Sandbox (default on new accounts) | Production |
|---|---|---|
| Daily send limit | 200 emails/day | 50,000 emails/day |
| Send rate | 1 email/second | 14 emails/second |
| Can send to unverified addresses | No — verified only | Yes — any address |
| Bounce handling | Simulated only | Real bounce handling required |

> **Critical:** SES starts in sandbox mode on every new AWS account. You cannot send to real client email addresses until production access is requested and approved by AWS. This is a one-time manual request. Kundan must submit this request well before go-live — AWS typically approves within 24 hours.

### 8.2 All email types AuraDesk sends via SES

| Email type | Trigger | Sent by | Notes |
|---|---|---|---|
| Team member invite | Admin invites user | API service | JWT invite link, expires 48hrs |
| Password reset | User requests reset | API service | Reset link, expires 1hr, rate-limited per user |
| Welcome email | New org signup | API service | Onboarding steps, connect channels CTA |
| Invoice to client | Admin sends invoice | Worker service | PDF attachment + Stripe payment link, org-branded |
| Payment received | Stripe webhook fires | Worker service | Receipt to client + notification to admin |
| Invoice overdue reminder | Scheduled cron | Worker service | Auto-sent after due date via SQS job |
| Subscription confirmation | Plan upgrade/change | API service | New plan details, feature access summary |
| Trial expiry warning | 3 days before trial ends | Worker service | Scheduled via SQS, prompts plan selection |
| System alert (internal only) | CloudWatch alarm | SNS → SES | To Mehul only — high CPU, task failures, DLQ |

### 8.3 Three DNS records required before sending

All three must be added to Route 53. Without these, emails land in spam.

| Record type | Purpose | How to get values |
|---|---|---|
| TXT — SPF | Proves AuraDesk is authorised to send from this domain | Value: `v=spf1 include:amazonses.com ~all` |
| CNAME × 3 — DKIM | Cryptographically signs every email | SES auto-generates all 3 — copy from SES console |
| MX — MAIL FROM | Proper bounce routing | Value: `feedback-smtp.ap-south-1.amazonses.com` |

### 8.4 Bounce and complaint handling — required

If AuraDesk sends repeatedly to bounced addresses, AWS can suspend the SES account. Yash must build a suppression list:

- Create SNS topic `auradesk-ses-bounces` → subscribe SES to it → Worker service processes bounce events → marks email address as bounced in DB → never send to bounced addresses again
- Create SNS topic `auradesk-ses-complaints` → same flow → marks email as unsubscribed

### 8.5 SES email volume and cost by growth stage

| Stage | DAU | Emails/day | Monthly SES cost | Status |
|---|---|---|---|---|
| Dev/Test | Internal team | ~10–50 | < $1 | Sandbox mode |
| Launch | Up to 200 | ~100–300 | < $1 | Production mode |
| Early growth | 200–1,000 | ~500–2,000 | ~$1–5 | Production mode |
| Growth | 1,000–5,000 | ~2,000–10,000 | ~$5–20 | Production mode |
| Scale | 5,000–20,000 | ~10,000–40,000 | ~$20–80 | Request quota increase |

### 8.6 SES secrets to add to Secrets Manager

Add to both `auradesk/test/config` and `auradesk/prod/config`:

```
SES_FROM_EMAIL  = noreply@yourdomain.com
SES_FROM_NAME   = AuraDesk
AWS_SES_REGION  = ap-south-1
```

---

## 9. Kundan's Setup Guide — Phase 1 (Dev/Test)

Complete step-by-step for the test environment. Follow in order. Do not skip steps.

**Prerequisites before starting:**
- Client AWS account active with billing configured
- Slasheasy IAM Admin access granted to the AWS account
- Domain DNS access available
- GitHub repository created with correct branch structure
- All API credentials ready: OpenAI, Stripe, Meta App, Gmail OAuth

---

### Step 1 — Create VPC

1. **VPC → Create VPC → VPC and more**
2. Name tag: `auradesk-test-vpc`
3. IPv4 CIDR: `10.0.0.0/16`
4. Availability Zones: **2**
5. Public subnets: **2**
6. Private subnets: **2** (these will be used as isolated subnets for RDS)
7. NAT Gateways: **None** — not needed in dev/test
8. VPC endpoints: tick **S3 Gateway** — saves NAT costs for S3 traffic
9. Click **Create VPC**

Rename subnets after creation:
- `auradesk-test-public-az-a`
- `auradesk-test-public-az-b`
- `auradesk-test-isolated-db-az-a`
- `auradesk-test-isolated-db-az-b`

---

### Step 2 — Create Security Groups

**VPC → Security Groups → Create security group**

**ECS Security Group** (`auradesk-test-ecs-sg`)
- VPC: `auradesk-test-vpc`
- Inbound rules:
  - HTTPS 443 from 0.0.0.0/0
  - HTTP 80 from 0.0.0.0/0
  - Custom TCP 3000 from 0.0.0.0/0 (API service)
  - Custom TCP 3001 from 0.0.0.0/0 (Webhook service)
- Outbound: All traffic to anywhere

**RDS Security Group** (`auradesk-test-rds-sg`)
- VPC: `auradesk-test-vpc`
- Inbound: PostgreSQL 5432 from `auradesk-test-ecs-sg` only
- Outbound: None

---

### Step 3 — Create RDS PostgreSQL

1. **RDS → Create database**
2. Engine: **PostgreSQL** — latest stable version
3. Template: **Dev/Test**
4. DB instance identifier: `auradesk-test-db`
5. Master username: `auradesk_admin`
6. Master password: generate a strong password — **save to Secrets Manager immediately**
7. Instance class: `db.t3.micro`
8. Storage: 20 GB gp3 — enable autoscaling up to 100 GB
9. Multi-AZ: **No**
10. VPC: `auradesk-test-vpc`
11. Subnet group: create new — select both isolated subnets
12. Public access: **No**
13. Security group: `auradesk-test-rds-sg`
14. Database name: `auradesk`
15. Backup retention: **1 day**
16. Click **Create database**

Note the endpoint URL after creation — goes into Secrets Manager as `DATABASE_URL`.

---

### Step 4 — Create S3 Buckets

Create two buckets:

**Files bucket** (`auradesk-test-files`)
1. **S3 → Create bucket**
2. Region: `ap-south-1`
3. Block all public access: **Yes** (all four checkboxes ticked)
4. Versioning: **Enabled**
5. Server-side encryption: **SSE-S3**

**Static frontend bucket** (`auradesk-test-static`)
1. Same settings as above
2. This bucket connects to CloudFront in Step 13

---

### Step 5 — Create ECR Repositories

1. **ECR → Repositories → Create repository**
2. Create three repositories:
   - `auradesk-test/api`
   - `auradesk-test/webhook`
   - `auradesk-test/worker`
3. Image scan on push: **Enabled**
4. Encryption: **AES-256**

Note all 3 repository URIs — they go into GitHub Secrets.

---

### Step 6 — Create SQS Queue

1. **SQS → Create queue → Standard**
2. Name: `auradesk-test-jobs`
3. Message retention: **4 days**
4. Visibility timeout: **300 seconds**
5. Dead-letter queue: create DLQ first
   - Name: `auradesk-test-jobs-dlq`
   - Then attach to main queue with max receives: **3**
6. Encryption: **SSE-SQS**

Note the Queue URL — goes into Secrets Manager.

---

### Step 7 — Store All Secrets in Secrets Manager

1. **Secrets Manager → Store a new secret → Other type of secret**
2. Secret name: `auradesk/test/config`
3. Add all key-value pairs:

```
DATABASE_URL          = postgresql://auradesk_admin:<password>@<rds-endpoint>:5432/auradesk
AWS_S3_BUCKET         = auradesk-test-files
AWS_SQS_QUEUE_URL     = <sqs-queue-url>
JWT_SECRET            = <generate random 64 char string>
OPENAI_API_KEY        = <from OpenAI dashboard>
STRIPE_SECRET_KEY     = <from Stripe dashboard>
STRIPE_WEBHOOK_SECRET = <from Stripe dashboard>
META_APP_SECRET       = <from Meta developer portal>
META_VERIFY_TOKEN     = <generate random string>
GMAIL_CLIENT_ID       = <from Google Cloud Console>
GMAIL_CLIENT_SECRET   = <from Google Cloud Console>
ENCRYPTION_KEY        = <generate random 32 char hex string>
SESSION_DRIVER        = memory
SES_FROM_EMAIL        = noreply@yourdomain.com
SES_FROM_NAME         = AuraDesk
AWS_SES_REGION        = ap-south-1
NODE_ENV              = test
```

> Note: `REDIS_URL` is intentionally not included in dev/test. `SESSION_DRIVER=memory` is used instead.

---

### Step 8 — Create IAM Roles for ECS

**Task role** (`auradesk-ecs-task-role`)
1. **IAM → Roles → Create role**
2. Trusted entity: AWS service → Elastic Container Service → ECS Task
3. Attach policies:
   - `AmazonS3FullAccess`
   - `AmazonSQSFullAccess`
   - `AmazonSESFullAccess`
   - `SecretsManagerReadWrite`
   - `CloudWatchLogsFullAccess`

**Execution role** (`auradesk-ecs-execution-role`)
1. Same process
2. Trusted entity: ECS Task
3. Attach policies:
   - `AmazonECSTaskExecutionRolePolicy`
   - `SecretsManagerReadWrite`

---

### Step 9 — Create ECS Cluster

1. **ECS → Clusters → Create cluster**
2. Cluster name: `auradesk-test-cluster`
3. Infrastructure: **AWS Fargate (serverless)** — tick only Fargate, not EC2
4. Enable Container Insights: **Yes**
5. Click **Create**

---

### Step 10 — Create CloudWatch Log Groups

**CloudWatch → Log groups → Create log group**

| Log group name | Retention |
|---|---|
| `/auradesk/test/api` | 30 days |
| `/auradesk/test/webhook` | 30 days |
| `/auradesk/test/worker` | 30 days |

---

### Step 11 — Create ECS Task Definitions

**ECS → Task Definitions → Create new task definition** — create one per service (3 total).

**API task definition** (`auradesk-test-api`)

| Field | Value |
|---|---|
| Launch type | AWS Fargate |
| OS/Architecture | Linux/X86_64 |
| CPU | 0.5 vCPU |
| Memory | 1 GB |
| Task role | auradesk-ecs-task-role |
| Execution role | auradesk-ecs-execution-role |

Container:
- Name: `api`
- Image: `<account-id>.dkr.ecr.ap-south-1.amazonaws.com/auradesk-test/api:latest`
- Port: `3000`
- Environment variable: `NODE_ENV=test`
- Secrets from Secrets Manager — add each key from `auradesk/test/config`:
  - Key: `DATABASE_URL` → Secret: `auradesk/test/config:DATABASE_URL`
  - Repeat for all keys in the secret
- Log driver: `awslogs` | Log group: `/auradesk/test/api` | Region: `ap-south-1` | Prefix: `api`
- Health check: `CMD-SHELL, curl -f http://localhost:3000/health || exit 1`

**Webhook task definition** (`auradesk-test-webhook`)

Same as API but:
- CPU: `0.25 vCPU` | Memory: `0.5 GB`
- Container port: `3001`
- Image: `auradesk-test/webhook:latest`
- Health check: `CMD-SHELL, curl -f http://localhost:3001/webhooks/health || exit 1`
- Log group: `/auradesk/test/webhook` | Prefix: `webhook`

**Worker task definition** (`auradesk-test-worker`)

Same as API but:
- No port mapping (worker has no HTTP server — it polls SQS)
- Image: `auradesk-test/worker:latest`
- Log group: `/auradesk/test/worker` | Prefix: `worker`
- No health check (no HTTP endpoint)

---

### Step 12 — Create ECS Services

**ECS → Clusters → auradesk-test-cluster → Services → Create** — create all three services.

| Field | API Service | Webhook Service | Worker Service |
|---|---|---|---|
| Task definition | auradesk-test-api | auradesk-test-webhook | auradesk-test-worker |
| Service name | auradesk-test-api | auradesk-test-webhook | auradesk-test-worker |
| Desired tasks | 1 | 1 | 1 |
| VPC | auradesk-test-vpc | auradesk-test-vpc | auradesk-test-vpc |
| Subnets | Both public subnets | Both public subnets | Both public subnets |
| Security group | auradesk-test-ecs-sg | auradesk-test-ecs-sg | auradesk-test-ecs-sg |
| **Public IP** | **On** | **On** | **On** |
| Load balancing | None | None | None |
| Auto scaling | Off | Off | Off |

---

### Step 13 — Set Up CloudFront for Frontend

1. **CloudFront → Create distribution**
2. Origin: `auradesk-test-static` S3 bucket
3. Origin access: **Origin Access Control** → Create new OAC → Update S3 bucket policy when prompted
4. Viewer protocol policy: **Redirect HTTP to HTTPS**
5. Default root object: `index.html`
6. Alternate domain names: `test.yourdomain.com`
7. SSL certificate: select from ACM (set up in Step 14)
8. Custom error responses — add both:
   - 403 → `/index.html` → 200 (required for React Router to work)
   - 404 → `/index.html` → 200

---

### Step 14 — Route 53 DNS + ACM SSL Certificate

**Request certificate:**
1. **ACM → Request certificate → Public certificate**
2. Domain names: `yourdomain.com` and `*.yourdomain.com`
3. Validation method: **DNS validation**
4. Add the generated CNAME records to Route 53
5. Wait ~5 minutes for validation to complete

**Create DNS record:**
1. **Route 53 → Hosted zones → select yourdomain.com**
2. Create record:
   - Name: `test.yourdomain.com`
   - Type: **A (Alias)**
   - Alias target: Alias to CloudFront distribution

---

### Step 15 — Set Up SES for Dev/Test (Sandbox Mode)

1. **SES → Verified identities → Create identity → Domain**
2. Enter `yourdomain.com`
3. Add the DNS records SES provides to Route 53:
   - TXT record for SPF: `v=spf1 include:amazonses.com ~all`
   - 3 CNAME records for DKIM (values generated by SES — copy exactly)
4. Wait for domain verification (~5–10 minutes) — status shows `Verified`
5. Add each team member's email as a verified identity for sandbox testing:
   - **SES → Verified identities → Create identity → Email address**
   - Each person receives a verification email and must click the confirmation link

---

### Step 16 — Dev/Test Verification Checklist

Run through this after completing all steps:

- [ ] VPC created with 2 public subnets + 2 isolated subnets across 2 AZs
- [ ] ECS security group allows ports 80, 443, 3000, 3001 inbound from internet
- [ ] RDS security group allows 5432 from ECS SG only — not from internet
- [ ] RDS instance in Available state — note the endpoint URL
- [ ] Both S3 buckets created — public access blocked on both
- [ ] All 3 ECR repositories created — URIs noted for GitHub Secrets
- [ ] SQS queue and DLQ created — Queue URL noted
- [ ] All secrets stored in Secrets Manager under `auradesk/test/config`
- [ ] Both IAM roles created with correct policies attached
- [ ] ECS cluster created (Fargate mode only — no EC2)
- [ ] All 3 CloudWatch log groups created with 30-day retention
- [ ] All 3 task definitions created — each has correct CPU, memory, image, secrets, log config
- [ ] All 3 ECS services running — tasks show **RUNNING** state in console
- [ ] All tasks have a **public IP** assigned — note the IPs for testing
- [ ] CloudFront distribution deployed — status shows **Enabled**
- [ ] ACM certificate status shows **Issued**
- [ ] Route 53 A record pointing `test.yourdomain.com` to CloudFront
- [ ] SES domain verified — DKIM status shows **Success**
- [ ] Team member emails verified in SES sandbox
- [ ] Health checks return 200:
  - `http://<api-task-public-ip>:3000/health`
  - `http://<webhook-task-public-ip>:3001/webhooks/health`
- [ ] Frontend loads correctly at `test.yourdomain.com`

---

## 10. Kundan's Setup Guide — Phase 2 (Production)

When Yash and Krupa confirm a stable release is ready for production, Kundan adds these components. Dev/test environment continues running untouched throughout.

**Estimated time: half a day of AWS console work.**

---

### Step 1 — Create Production VPC (3 subnet tiers)

1. **VPC → Create VPC → VPC and more**
2. Name tag: `auradesk-prod-vpc`
3. IPv4 CIDR: `10.1.0.0/16` (different from test VPC — no overlap)
4. Availability Zones: **2**
5. Public subnets: **2**
6. Private subnets: **4** (2 for ECS, 2 for DB)
7. NAT Gateways: **1 per AZ**
8. VPC endpoints: **S3 Gateway**

Rename subnets:
- `auradesk-prod-public-az-a`, `auradesk-prod-public-az-b`
- `auradesk-prod-private-ecs-az-a`, `auradesk-prod-private-ecs-az-b`
- `auradesk-prod-isolated-db-az-a`, `auradesk-prod-isolated-db-az-b`

---

### Step 2 — Create Production Security Groups

**ALB Security Group** (`auradesk-prod-alb-sg`)
- Inbound: HTTPS 443 from 0.0.0.0/0 | HTTP 80 from 0.0.0.0/0
- Outbound: All traffic

**ECS Security Group** (`auradesk-prod-ecs-sg`)
- Inbound: All traffic from `auradesk-prod-alb-sg` only (not from internet directly)
- Outbound: All traffic

**RDS Security Group** (`auradesk-prod-rds-sg`)
- Inbound: PostgreSQL 5432 from `auradesk-prod-ecs-sg` only
- Outbound: None

**Redis Security Group** (`auradesk-prod-redis-sg`)
- Inbound: Custom TCP 6379 from `auradesk-prod-ecs-sg` only
- Outbound: None

---

### Step 3 — Create Production RDS PostgreSQL

| Setting | Dev/Test | Production |
|---|---|---|
| Identifier | auradesk-test-db | auradesk-prod-db |
| Instance class | db.t3.micro | **db.t3.medium** |
| Multi-AZ | No | **Yes** |
| Backup retention | 1 day | **7 days** |
| Performance Insights | No | **Yes** |
| Security group | auradesk-test-rds-sg | auradesk-prod-rds-sg |
| Subnet group | test isolated subnets | prod isolated subnets |

After RDS is created, add a read replica:
1. **RDS → select prod DB → Actions → Create read replica**
2. Instance class: `db.t3.micro`
3. Same VPC, same security group

Note both the primary endpoint and the read replica endpoint — both go into Secrets Manager.

---

### Step 4 — Create ElastiCache Redis

1. **ElastiCache → Create cluster → Cluster mode: Disabled**
2. Name: `auradesk-prod-redis`
3. Engine: Redis 7.x latest
4. Node type: `cache.t3.small`
5. Number of replicas: **1**
6. Subnet group: create new — select both prod isolated subnets
7. Security group: `auradesk-prod-redis-sg`
8. Encryption at rest: **Enabled**
9. Encryption in transit: **Enabled**

Note the Primary Endpoint URL — add to `auradesk/prod/config` in Secrets Manager.

---

### Step 5 — Create Prod S3 Buckets and ECR Repositories

**S3 buckets:**
- `auradesk-prod-files` (same settings as test)
- `auradesk-prod-static` (same settings as test)

**ECR repositories:**
- `auradesk-prod/api`
- `auradesk-prod/webhook`
- `auradesk-prod/worker`

---

### Step 6 — Create Prod SQS Queue

- `auradesk-prod-jobs` + DLQ `auradesk-prod-jobs-dlq`
- Same settings as test

---

### Step 7 — Create Prod Secrets Manager Secret

1. Secret name: `auradesk/prod/config`
2. Same keys as test config, updated with prod values, plus:

```
DATABASE_URL    = postgresql://auradesk_admin:<pw>@<prod-rds-endpoint>:5432/auradesk
REDIS_URL       = redis://<elasticache-prod-endpoint>:6379
SESSION_DRIVER  = redis
NODE_ENV        = production
AWS_S3_BUCKET   = auradesk-prod-files
```

---

### Step 8 — Create Prod ECS Cluster, Log Groups, and Task Definitions

**ECS cluster:**
- Name: `auradesk-prod-cluster`
- Infrastructure: Fargate only
- Container Insights: Yes

**Log groups** (90-day retention):
- `/auradesk/prod/api`
- `/auradesk/prod/webhook`
- `/auradesk/prod/worker`

**Task definitions** — same process as test but:
- Names: `auradesk-prod-api`, `auradesk-prod-webhook`, `auradesk-prod-worker`
- Images: from `auradesk-prod/` ECR repos
- Secrets source: `auradesk/prod/config`
- Log groups: `/auradesk/prod/*`

Task sizes:

| Task definition | vCPU | Memory |
|---|---|---|
| auradesk-prod-api | 0.5 | 1 GB |
| auradesk-prod-webhook | 0.25 | 0.5 GB |
| auradesk-prod-worker | 0.5 | 1 GB |

---

### Step 9 — Create Application Load Balancer

1. **EC2 → Load Balancers → Create → Application Load Balancer**
2. Name: `auradesk-prod-alb`
3. Scheme: **Internet-facing**
4. VPC: `auradesk-prod-vpc`
5. Subnets: both **public** subnets
6. Security group: `auradesk-prod-alb-sg`

**Create target groups (IP type — required for Fargate):**

| Target group | Port | Health check path | Healthy threshold |
|---|---|---|---|
| auradesk-prod-api-tg | 3000 | /health | 2 |
| auradesk-prod-webhook-tg | 3001 | /webhooks/health | 2 |

**Listener rules:**
- HTTP 80: redirect all to HTTPS 443
- HTTPS 443 (in order):
  1. Path `/webhooks/*` → forward to `auradesk-prod-webhook-tg`
  2. Path `/api/*` → forward to `auradesk-prod-api-tg`
  3. Default: return 404

Attach the ACM wildcard certificate to the HTTPS listener.

---

### Step 10 — Create Production ECS Services

| Field | API | Webhook | Worker |
|---|---|---|---|
| Task definition | auradesk-prod-api | auradesk-prod-webhook | auradesk-prod-worker |
| Service name | auradesk-prod-api | auradesk-prod-webhook | auradesk-prod-worker |
| Desired tasks | 2 | 2 | 1 |
| Subnets | **Both private ECS subnets** | **Both private ECS subnets** | **Both private ECS subnets** |
| Security group | auradesk-prod-ecs-sg | auradesk-prod-ecs-sg | auradesk-prod-ecs-sg |
| **Public IP** | **Off** | **Off** | **Off** |
| Load balancing | ALB → api-tg | ALB → webhook-tg | None |
| Auto scaling | CPU 60% out / 30% in | Request count | SQS queue depth |

---

### Step 11 — Set Up WAF

1. **WAF → Create web ACL → Regional → ap-south-1**
2. Add managed rule groups:
   - `AWSManagedRulesCommonRuleSet`
   - `AWSManagedRulesKnownBadInputsRuleSet`
   - `AWSManagedRulesAmazonIpReputationList`
3. Associate with `auradesk-prod-alb`

---

### Step 12 — Route 53 DNS for Production

Add record to hosted zone:
- Name: `yourdomain.com`
- Type: **A (Alias)**
- Alias target: Alias to `auradesk-prod-alb`

---

### Step 13 — CloudFront for Production Frontend

Same process as test but:
- Origin: `auradesk-prod-static`
- Alternate domain: `yourdomain.com`
- Attach same ACM wildcard certificate
- Same custom error responses (403/404 → index.html → 200)

---

### Step 14 — Request SES Production Access

1. **SES → Account dashboard → Request production access**
2. Fill in the form:
   - Mail type: **Transactional**
   - Website URL: `yourdomain.com`
   - Use case: team invites, password resets, invoice delivery, payment receipts
   - Daily email volume: 500 emails/day initially
   - How you handle bounces: suppression list maintained in database
3. Submit — AWS approves within 24 hours
4. After approval, also set up bounce and complaint SNS topics (see Section 8.4)

---

### Step 15 — CloudWatch Alarms + SNS Alerts

1. **SNS → Create topic → Standard → Name: `auradesk-alerts`**
2. Create subscription: email → Mehul's email address
3. Mehul clicks the confirmation link in the email
4. Create these 6 CloudWatch alarms — all route to `auradesk-alerts`:

| Alarm name | Metric | Threshold | Period |
|---|---|---|---|
| auradesk-high-cpu | ECS CPUUtilization | > 80% | 5 minutes |
| auradesk-task-failure | ECS RunningTaskCount | < desired count | 2 minutes |
| auradesk-rds-connections | DatabaseConnections | > 80 | 5 minutes |
| auradesk-dlq-messages | ApproximateNumberOfMessages | > 0 | 1 minute |
| auradesk-alb-5xx | HTTPCode_Target_5XX_Count | > 10 | 1 minute |
| auradesk-rds-storage | FreeStorageSpace | < 5 GB | 5 minutes |

---

### Step 16 — Production Verification Checklist

- [ ] VPC with 6 subnets — 2 public, 2 private ECS, 2 isolated DB — across 2 AZs
- [ ] NAT Gateways active in both public subnets
- [ ] All 4 security groups created with correct rules
- [ ] RDS Multi-AZ — primary and standby both in Available state
- [ ] RDS read replica in Available state
- [ ] ElastiCache Redis — primary and replica both in Available state
- [ ] ALB created — listener rules in correct order — target groups healthy
- [ ] ACM certificate Issued — attached to ALB HTTPS listener
- [ ] WAF attached to ALB — managed rules active
- [ ] All 3 ECS services in Running state — tasks in **private** subnets
- [ ] Tasks have **no public IP** assigned (confirm in ECS task details)
- [ ] Route 53 A record pointing `yourdomain.com` to ALB
- [ ] CloudFront prod distribution deployed and Enabled
- [ ] SES production access approved — confirmed in SES console
- [ ] SES bounce and complaint SNS topics created
- [ ] All 6 CloudWatch alarms in OK state
- [ ] SNS email subscription confirmed by Mehul
- [ ] Health checks return 200 via ALB:
  - `https://yourdomain.com/api/health`
  - `https://yourdomain.com/webhooks/health`
- [ ] Frontend loads correctly at `yourdomain.com`
- [ ] Send a test invoice email — confirm it arrives in inbox (not spam)

---

## 11. CI/CD Pipeline

### 11.1 GitHub Secrets required

Add to: GitHub repository → Settings → Secrets and variables → Actions

```
AWS_ACCESS_KEY_ID           # IAM user for GitHub Actions deployments
AWS_SECRET_ACCESS_KEY       # IAM user secret
AWS_REGION                  # ap-south-1

# Test environment
ECR_API_REPO_TEST           # Full ECR URI for auradesk-test/api
ECR_WEBHOOK_REPO_TEST       # Full ECR URI for auradesk-test/webhook
ECR_WORKER_REPO_TEST        # Full ECR URI for auradesk-test/worker
ECS_CLUSTER_TEST            # auradesk-test-cluster
ECS_SERVICE_API_TEST        # auradesk-test-api
ECS_SERVICE_WEBHOOK_TEST    # auradesk-test-webhook
ECS_SERVICE_WORKER_TEST     # auradesk-test-worker

# Production environment
ECR_API_REPO_PROD           # Full ECR URI for auradesk-prod/api
ECR_WEBHOOK_REPO_PROD       # Full ECR URI for auradesk-prod/webhook
ECR_WORKER_REPO_PROD        # Full ECR URI for auradesk-prod/worker
ECS_CLUSTER_PROD            # auradesk-prod-cluster
ECS_SERVICE_API_PROD        # auradesk-prod-api
ECS_SERVICE_WEBHOOK_PROD    # auradesk-prod-webhook
ECS_SERVICE_WORKER_PROD     # auradesk-prod-worker
```

### 11.2 deploy-test.yml

Triggers on merge to `test` branch.

```yaml
name: Deploy to Test

on:
  push:
    branches: [test]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set image tag
        id: tag
        run: echo "TAG=$(echo $GITHUB_SHA | head -c7)" >> $GITHUB_OUTPUT

      - name: Build and push API image
        run: |
          docker build -t ${{ secrets.ECR_API_REPO_TEST }}:${{ steps.tag.outputs.TAG }} ./apps/api
          docker push ${{ secrets.ECR_API_REPO_TEST }}:${{ steps.tag.outputs.TAG }}

      - name: Build and push Webhook image
        run: |
          docker build -t ${{ secrets.ECR_WEBHOOK_REPO_TEST }}:${{ steps.tag.outputs.TAG }} ./apps/webhook
          docker push ${{ secrets.ECR_WEBHOOK_REPO_TEST }}:${{ steps.tag.outputs.TAG }}

      - name: Build and push Worker image
        run: |
          docker build -t ${{ secrets.ECR_WORKER_REPO_TEST }}:${{ steps.tag.outputs.TAG }} ./apps/worker
          docker push ${{ secrets.ECR_WORKER_REPO_TEST }}:${{ steps.tag.outputs.TAG }}

      - name: Update ECS services
        run: |
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_API_TEST }} --force-new-deployment
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_WEBHOOK_TEST }} --force-new-deployment
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_WORKER_TEST }} --force-new-deployment

      - name: Wait for deployments to stabilise
        run: |
          aws ecs wait services-stable \
            --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --services \
              ${{ secrets.ECS_SERVICE_API_TEST }} \
              ${{ secrets.ECS_SERVICE_WEBHOOK_TEST }} \
              ${{ secrets.ECS_SERVICE_WORKER_TEST }}
```

### 11.3 deploy-prod.yml

Triggers on merge to `main` branch. Deploys to prod and auto-creates version tag.

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ secrets.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Calculate next version
        id: version
        run: |
          git fetch --tags
          LATEST=$(git tag --sort=-v:refname | head -1)
          if [ -z "$LATEST" ]; then LATEST="v0.0.0"; fi
          MAJOR=$(echo $LATEST | cut -d. -f1 | tr -d 'v')
          MINOR=$(echo $LATEST | cut -d. -f2)
          PATCH=$(echo $LATEST | cut -d. -f3)
          NEW_PATCH=$((PATCH + 1))
          echo "VERSION=v${MAJOR}.${MINOR}.${NEW_PATCH}" >> $GITHUB_OUTPUT

      - name: Build and push all images
        run: |
          TAG=${{ steps.version.outputs.VERSION }}
          docker build -t ${{ secrets.ECR_API_REPO_PROD }}:$TAG ./apps/api
          docker push ${{ secrets.ECR_API_REPO_PROD }}:$TAG
          docker build -t ${{ secrets.ECR_WEBHOOK_REPO_PROD }}:$TAG ./apps/webhook
          docker push ${{ secrets.ECR_WEBHOOK_REPO_PROD }}:$TAG
          docker build -t ${{ secrets.ECR_WORKER_REPO_PROD }}:$TAG ./apps/worker
          docker push ${{ secrets.ECR_WORKER_REPO_PROD }}:$TAG

      - name: Deploy to production ECS
        run: |
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_API_PROD }} --force-new-deployment
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_WEBHOOK_PROD }} --force-new-deployment
          aws ecs update-service --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_WORKER_PROD }} --force-new-deployment

      - name: Wait for production to stabilise
        run: |
          aws ecs wait services-stable \
            --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --services \
              ${{ secrets.ECS_SERVICE_API_PROD }} \
              ${{ secrets.ECS_SERVICE_WEBHOOK_PROD }} \
              ${{ secrets.ECS_SERVICE_WORKER_PROD }}

      - name: Tag release
        run: |
          TAG=${{ steps.version.outputs.VERSION }}
          git config user.name "github-actions"
          git config user.email "actions@github.com"
          git tag $TAG
          git push origin $TAG

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          tag_name: ${{ steps.version.outputs.VERSION }}
          generate_release_notes: true
```

---

## 12. Dockerfile Templates

### API service (`apps/api/Dockerfile`)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/api --workspace=packages/shared

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/api

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/apps/api/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/apps/api/package.json .
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "dist/index.js"]
```

### Webhook service (`apps/webhook/Dockerfile`)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY apps/webhook/package*.json ./apps/webhook/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/webhook --workspace=packages/shared

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/webhook

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/apps/webhook/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/apps/webhook/package.json .
USER appuser
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3001/webhooks/health || exit 1
CMD ["node", "dist/index.js"]
```

### Worker service (`apps/worker/Dockerfile`)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
COPY apps/worker/package*.json ./apps/worker/
COPY packages/shared/package*.json ./packages/shared/
RUN npm ci --workspace=apps/worker --workspace=packages/shared

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build --workspace=apps/worker

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/apps/worker/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/apps/worker/package.json .
USER appuser
CMD ["node", "dist/index.js"]
```

---

## 13. Capacity & Daily Active User Limits

### Binding constraint per component

| Component | Launch spec | Hard limit | Action when near limit |
|---|---|---|---|
| RDS db.t3.micro | 87 max connections | **~200 DAU** | Upgrade to db.t3.medium (+$35/mo) |
| API service | 1 task · 0.5 vCPU | ~500 DAU | Auto-scales — no action needed |
| Worker service | 1 task · 0.5 vCPU | ~50 AI jobs/hr | Auto-scales — no action needed |
| ElastiCache Redis | cache.t3.micro | ~10,000 sessions | Upgrade to cache.t3.small |
| SES sandbox | 200 emails/day | Internal team only | Request production access |
| SES production | 50,000 emails/day | ~5,000 DAU | Request quota increase |

> **RDS is the binding constraint at launch.** Everything else scales automatically or has a much higher ceiling. Plan the RDS upgrade before reaching 150 DAU.

### Growth stage summary

| Stage | DAU | Organisations | Bottleneck | Action needed |
|---|---|---|---|---|
| Launch | Up to 200 | 10–20 | RDS db.t3.micro | None — ship as-is |
| Early growth | 200–1,000 | 50–100 | RDS connections | Upgrade to db.t3.medium |
| Growth | 1,000–5,000 | 200–500 | DB read throughput | Add RDS read replica |
| Scale | 5,000–20,000 | 500–2,000 | DB size + AI rate | RDS Aurora, OpenAI tier upgrade |
| Enterprise | 20,000+ | 2,000+ | Full architecture | Architecture review required |

---

## 14. Rollback Procedure

### Option A — ECS console rollback (fastest, under 5 minutes)

1. **ECS → Clusters → auradesk-prod-cluster → Services**
2. Select the affected service → **Update service**
3. Under Task definition: select the **previous revision number**
4. Click **Update** — ECS performs a rolling rollback with zero downtime

### Option B — Git revert

```bash
# Find the last stable version tag
git tag --sort=-v:refname | head -5

# Revert the broken commit on main and push
git revert HEAD
git push origin main
# GitHub Actions detects the push and redeploys automatically
# Version tag increments as a patch (e.g. v1.2.0 → v1.2.1)
```

---

## 15. Cost Summary

| Phase | Environment | Monthly cost | Key components |
|---|---|---|---|
| Phase 1 | Dev/Test | ~$35–45 | ECS Fargate, RDS t3.micro, S3, CloudFront, SQS, SES, Route 53 |
| Phase 2 | Production | ~$215 | All dev/test + ALB, Redis, NAT Gateways, WAF, RDS t3.medium Multi-AZ + replica, alarms |
| Phase 2 | Dev/Test continues | ~$35–45 | Unchanged — runs in parallel with prod |
| **Total at prod launch** | **Both running** | **~$250–260/month** | Both environments live simultaneously |

---

*AuraDesk Infrastructure Plan v2.0 — Slasheasy — Confidential*
