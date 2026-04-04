# AuraDesk — Infrastructure & Deployment Plan

**Version:** 1.0  
**Prepared by:** Slasheasy  
**Document scope:** AWS architecture, ECS Fargate setup, CI/CD pipeline, branch strategy, versioning, and Kundan's manual setup guide

---

## 1. Overview

AuraDesk is deployed on Amazon Web Services using ECS Fargate as the compute layer. There are no EC2 instances to manage. The application runs as Docker containers orchestrated by AWS ECS — provisioned, scaled, and monitored by AWS automatically.

### Key decisions locked in

| Decision | Choice | Reason |
|---|---|---|
| Compute | ECS Fargate | No server management, scales per service, pay per use |
| Environments | Test + Production | Test for QA, Prod for live |
| Provisioning | Manual AWS Console | Kundan sets up, guided by this document |
| Repo structure | Monorepo | 3 Dockerfiles in one repo |
| App state | Stateless | Sessions in Redis, files in S3 only |
| Secrets | AWS Secrets Manager | No .env files in containers |
| CI/CD | GitHub Actions | Build → ECR → ECS rolling deploy |
| Versioning | Semantic (MAJOR.MINOR.PATCH) | Auto-tagged on every main merge |

---

## 2. Team Roles

| Person | Role | Responsibility |
|---|---|---|
| Yash | Developer | Writes code, pushes to developer branch |
| Jitendra | Code Reviewer | Reviews PRs before merge to test |
| Krupa | QA Tester | Tests on test environment, signs off before prod |
| Kundan | DevOps | Sets up and maintains AWS infrastructure |
| Mehul | Product Owner | Approves test → main PR, final production gate |

---

## 3. Branch Strategy

Three permanent branches — no direct pushes to test or main.

```
developer  →  test  →  main
```

### Branch rules

**developer branch**
- Yash develops and tests locally
- Raises PR to test branch when feature is complete
- Jitendra reviews code before merge is allowed
- GitHub Actions runs: install → lint → build → unit tests
- On pass: auto-deploys to Test environment

**test branch**
- Krupa runs QA on test.yourdomain.com
- Bugs logged in ClickUp → Yash fixes on developer → re-deploys
- When Krupa signs off: Mehul raises PR from test → main
- Mehul reviews and approves

**main branch**
- Production only
- GitHub Actions runs full build + test suite again
- On pass: auto-deploys to Production environment
- Auto-creates git tag and GitHub Release

### Rules enforced via GitHub branch protection

- No direct pushes to test or main — PRs only
- At least 1 reviewer approval required
- GitHub Actions must pass before merge is allowed
- main branch requires Mehul's approval specifically

---

## 4. Versioning Strategy

Semantic versioning: `MAJOR.MINOR.PATCH`

| Type | When | Example |
|---|---|---|
| MAJOR | Milestone go-live merged to prod | v1.0.0 (M1 live), v2.0.0 (M2 live) |
| MINOR | Feature merged to main | v1.1.0, v1.2.0 |
| PATCH | Bug fix merged to main | v1.1.1, v1.1.2 |

### AuraDesk version roadmap

```
v0.1.0  — Initial scaffold
v0.x.x  — During Milestone 1 build
v1.0.0  — Milestone 1 approved and live (Foundation + Inbox + AI)
v1.x.x  — During Milestone 2 build
v2.0.0  — Milestone 2 approved and live (Leads + Knowledge Base)
v2.x.x  — During Milestone 3 build
v3.0.0  — Milestone 3 approved and live (Invoices + Payments)
v3.x.x  — Post-launch patches and improvements
```

### How tagging works

Every successful deploy to production via GitHub Actions automatically:
1. Creates a git tag (e.g. `v1.2.0`) on the main branch
2. Pushes the tag to the GitHub repository
3. Creates a GitHub Release with auto-generated changelog
4. Updates CHANGELOG.md grouped by version

Tags only ever exist on main. developer and test branches are never tagged.

---

## 5. Application Architecture Requirements

Before any infrastructure is set up, the application must be built to these constraints.

### 5.1 Stateless containers (critical)

ECS Fargate containers do not persist local disk state between restarts. The application must:

- Store all sessions in Redis (ElastiCache) — no in-memory session state on the container
- Upload all files directly to S3 — no local disk writes for user files
- Read all configuration from environment variables at startup — no .env files baked into the image
- Be safe to run multiple identical copies simultaneously (no singleton assumptions)

### 5.2 Monorepo structure

```
auradesk/
├── apps/
│   ├── api/                  # Node.js Express API
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   ├── webhook/              # Webhook handler service
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   └── worker/               # Background job worker (SQS)
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

### 5.3 Three services — what each does

**API service** (`apps/api`)
- Handles all business logic: auth, inbox, leads, invoices, AI replies
- Receives traffic from ALB on path `/api/*`
- Connects to: RDS PostgreSQL, ElastiCache Redis, S3, SQS, OpenAI, Stripe
- Scales based on CPU utilisation (target 60%)

**Webhook service** (`apps/webhook`)
- Receives inbound webhooks from Meta (WhatsApp, Facebook, Instagram) and Gmail Pub/Sub
- Receives traffic from ALB on path `/webhooks/*`
- Validates webhook signatures, writes to SQS queue for async processing
- Scales based on request count

**Worker service** (`apps/worker`)
- Pulls jobs from SQS queue — AI reply generation, email sending, invoice reminders
- No ALB traffic — runs as a long-polling consumer
- Connects to: SQS, RDS, Redis, S3, OpenAI, SES
- Scales based on SQS queue depth

---

## 6. AWS Architecture

### 6.1 VPC layout

```
VPC: 10.0.0.0/16

Public subnets (ALB lives here)
  AZ-A: 10.0.1.0/24
  AZ-B: 10.0.2.0/24

Private subnets (ECS Fargate tasks live here)
  AZ-A: 10.0.3.0/24
  AZ-B: 10.0.4.0/24

Isolated subnets (RDS + Redis — no internet routing)
  AZ-A: 10.0.5.0/24
  AZ-B: 10.0.6.0/24
```

### 6.2 Traffic flow

```
Internet
  ↓
Internet Gateway
  ↓
WAF (blocks malicious traffic)
  ↓
CloudFront CDN (static assets served from S3 edge)
  ↓
ALB — Application Load Balancer (public subnet)
  /api/*      → API service tasks (private subnet)
  /webhooks/* → Webhook service tasks (private subnet)
  ↓
ECS Fargate tasks (private subnet)
  ↓
RDS PostgreSQL + ElastiCache Redis (isolated subnet)

ECS tasks → NAT Gateway → Internet (outbound only: OpenAI, Stripe, Meta APIs)
```

### 6.3 Security group rules

| Resource | Inbound rule | Outbound rule |
|---|---|---|
| ALB | 443 from 0.0.0.0/0 (internet) | All to ECS SG |
| ECS tasks | All from ALB SG only | All to RDS SG, Redis SG, internet via NAT |
| RDS | 5432 from ECS SG only | None |
| ElastiCache | 6379 from ECS SG only | None |

### 6.4 AWS services used

| Service | Purpose | Spec (launch) |
|---|---|---|
| ECS Fargate | Container compute | Per-task vCPU + memory |
| ECR | Docker image registry | Per-repo |
| ALB | Load balancing + routing | 1 per environment |
| RDS PostgreSQL | Primary database | db.t3.medium |
| ElastiCache Redis | Sessions, quota, cache | cache.t3.micro |
| S3 | File storage + static frontend | Pay per use |
| SQS | Async job queue | Standard queue |
| CloudFront | CDN for frontend | Global edge |
| Route 53 | DNS | Hosted zone |
| ACM | SSL certificates | Free with AWS |
| WAF | Web application firewall | Per request |
| Secrets Manager | API keys and credentials | Per secret |
| CloudWatch | Logs, metrics, alerts | Per log group |
| SES | Transactional email | Per email |
| NAT Gateway | Outbound internet for ECS | 1 per AZ |

### 6.5 ECS Fargate task sizes

| Service | vCPU | Memory | Min tasks | Max tasks | Scale trigger |
|---|---|---|---|---|---|
| API | 0.5 | 1 GB | 1 | 10 | CPU > 60% |
| Webhook | 0.25 | 0.5 GB | 1 | 4 | Request count |
| Worker | 0.5 | 1 GB | 1 | 6 | SQS queue depth > 10 |

---

## 7. Kundan's AWS Console Setup Guide

Complete step-by-step for both Test and Production environments.

### Prerequisites before starting

- Client AWS account active with billing configured
- Slasheasy IAM Admin access granted (slasheasy user added as IAM Admin)
- Domain DNS access available
- GitHub repository created with correct branch structure
- All API credentials ready: OpenAI, Stripe, Meta App, Gmail OAuth

---

### Step 1 — Create the VPC

1. Go to **VPC → Create VPC**
2. Select **VPC and more**
3. Set name tag: `auradesk-vpc`
4. IPv4 CIDR: `10.0.0.0/16`
5. Number of Availability Zones: **2**
6. Number of public subnets: **2**
7. Number of private subnets: **4** (2 for ECS, 2 for DB)
8. NAT Gateways: **1 per AZ**
9. VPC endpoints: **S3 Gateway** (tick this — saves NAT costs for S3 traffic)
10. Click **Create VPC**

After creation, rename subnets clearly:
- `auradesk-public-az-a`, `auradesk-public-az-b`
- `auradesk-private-ecs-az-a`, `auradesk-private-ecs-az-b`
- `auradesk-isolated-db-az-a`, `auradesk-isolated-db-az-b`

Repeat this VPC creation for both test and prod (name them `auradesk-test-vpc` and `auradesk-prod-vpc`).

---

### Step 2 — Create Security Groups

Go to **VPC → Security Groups → Create security group**

**ALB Security Group** (`auradesk-alb-sg`)
- VPC: select your VPC
- Inbound: HTTPS 443 from 0.0.0.0/0 | HTTP 80 from 0.0.0.0/0
- Outbound: All traffic to anywhere

**ECS Security Group** (`auradesk-ecs-sg`)
- VPC: select your VPC
- Inbound: All traffic from `auradesk-alb-sg` (select the SG, not an IP)
- Outbound: All traffic to anywhere

**RDS Security Group** (`auradesk-rds-sg`)
- VPC: select your VPC
- Inbound: PostgreSQL 5432 from `auradesk-ecs-sg`
- Outbound: None

**Redis Security Group** (`auradesk-redis-sg`)
- VPC: select your VPC
- Inbound: Custom TCP 6379 from `auradesk-ecs-sg`
- Outbound: None

Create these four security groups in both test and prod VPCs.

---

### Step 3 — Create RDS PostgreSQL

1. Go to **RDS → Create database**
2. Engine: **PostgreSQL** — latest stable version
3. Template: **Production** (for prod env) | **Dev/Test** (for test env)
4. DB instance identifier: `auradesk-prod-db` or `auradesk-test-db`
5. Master username: `auradesk_admin`
6. Master password: generate a strong password — save it in Secrets Manager immediately
7. Instance class: `db.t3.medium` (prod) | `db.t3.micro` (test)
8. Storage: 20 GB gp3, enable autoscaling up to 100 GB
9. Multi-AZ: **Yes** (prod) | **No** (test)
10. VPC: select the correct VPC
11. Subnet group: create new — select both isolated subnets
12. Public access: **No**
13. Security group: `auradesk-rds-sg`
14. Database name: `auradesk`
15. Backup retention: 7 days (prod) | 1 day (test)
16. Enable Performance Insights: Yes (prod)
17. Click **Create database**

Note the endpoint URL after creation — goes into Secrets Manager.

---

### Step 4 — Create ElastiCache Redis

1. Go to **ElastiCache → Create cluster**
2. Cluster mode: **Disabled** (single node to start)
3. Name: `auradesk-prod-redis` or `auradesk-test-redis`
4. Engine version: Redis 7.x latest
5. Node type: `cache.t3.small` (prod) | `cache.t3.micro` (test)
6. Number of replicas: **1** (prod) | **0** (test)
7. Subnet group: create new — select both isolated subnets
8. Security group: `auradesk-redis-sg`
9. Encryption at rest: **Enabled**
10. Encryption in transit: **Enabled**
11. Click **Create**

Note the Primary Endpoint URL — goes into Secrets Manager.

---

### Step 5 — Create S3 Buckets

Create two S3 buckets per environment:

**Files bucket** (`auradesk-prod-files` / `auradesk-test-files`)
1. Go to **S3 → Create bucket**
2. Region: ap-south-1 (Mumbai)
3. Block all public access: **Yes** (all ticked)
4. Versioning: **Enabled**
5. Server-side encryption: **SSE-S3**

**Static frontend bucket** (`auradesk-prod-static` / `auradesk-test-static`)
1. Same settings
2. This is where the React build gets uploaded
3. This bucket will be connected to CloudFront

---

### Step 6 — Create ECR Repositories

1. Go to **ECR → Repositories → Create repository**
2. Create three repositories per environment:
   - `auradesk-test/api` and `auradesk-prod/api`
   - `auradesk-test/webhook` and `auradesk-prod/webhook`
   - `auradesk-test/worker` and `auradesk-prod/worker`
3. Image scan on push: **Enabled**
4. Encryption: **AES-256**

Note all repository URIs — go into GitHub Secrets.

---

### Step 7 — Create SQS Queue

1. Go to **SQS → Create queue**
2. Type: **Standard**
3. Name: `auradesk-prod-jobs` / `auradesk-test-jobs`
4. Message retention: 4 days
5. Visibility timeout: 300 seconds (5 minutes — matches max job processing time)
6. Enable dead-letter queue:
   - Create a DLQ first: `auradesk-prod-jobs-dlq`
   - Max receives before DLQ: 3
7. Encryption: **SSE-SQS**

Note the Queue URL — goes into Secrets Manager.

---

### Step 8 — Create Secrets Manager Secrets

1. Go to **Secrets Manager → Store a new secret**
2. Type: **Other type of secret**
3. Create one secret per environment: `auradesk/test/config` and `auradesk/prod/config`

Add all key-value pairs:

```
DATABASE_URL          = postgresql://auradesk_admin:<password>@<rds-endpoint>:5432/auradesk
REDIS_URL             = redis://<elasticache-endpoint>:6379
AWS_S3_BUCKET         = auradesk-prod-files
AWS_SQS_QUEUE_URL     = <sqs-queue-url>
JWT_SECRET            = <generate-random-64-char-string>
OPENAI_API_KEY        = <from-openai>
STRIPE_SECRET_KEY     = <from-stripe>
STRIPE_WEBHOOK_SECRET = <from-stripe>
META_APP_SECRET       = <from-meta>
META_VERIFY_TOKEN     = <generate-random-string>
GMAIL_CLIENT_ID       = <from-google>
GMAIL_CLIENT_SECRET   = <from-google>
ENCRYPTION_KEY        = <generate-random-32-char-hex>
```

---

### Step 9 — Create IAM Role for ECS Tasks

1. Go to **IAM → Roles → Create role**
2. Trusted entity: **AWS service** → **Elastic Container Service** → **Elastic Container Service Task**
3. Name: `auradesk-ecs-task-role`
4. Attach these policies:
   - `AmazonS3FullAccess` (scope to your buckets in production)
   - `AmazonSQSFullAccess` (scope to your queues)
   - `AmazonSESFullAccess`
   - `SecretsManagerReadWrite` (scope to `auradesk/*` secrets)
   - `CloudWatchLogsFullAccess`

Also create the **ECS Task Execution Role**:
1. Name: `auradesk-ecs-execution-role`
2. Attach: `AmazonECSTaskExecutionRolePolicy`
3. Also add: `SecretsManagerReadWrite` (so ECS can pull secrets at startup)

---

### Step 10 — Create ECS Cluster

1. Go to **ECS → Clusters → Create cluster**
2. Cluster name: `auradesk-test-cluster` / `auradesk-prod-cluster`
3. Infrastructure: **AWS Fargate** (serverless) — tick only this
4. Enable Container Insights: **Yes**
5. Click **Create**

---

### Step 11 — Create CloudWatch Log Groups

1. Go to **CloudWatch → Log groups → Create log group**
2. Create these log groups:
   - `/auradesk/test/api`
   - `/auradesk/test/webhook`
   - `/auradesk/test/worker`
   - `/auradesk/prod/api`
   - `/auradesk/prod/webhook`
   - `/auradesk/prod/worker`
3. Retention: 30 days (test) | 90 days (prod)

---

### Step 12 — Create ECS Task Definitions

Go to **ECS → Task Definitions → Create new task definition**

Create one task definition per service per environment (6 total):

**Example: API service (prod)**

1. Task definition family: `auradesk-prod-api`
2. Launch type: **AWS Fargate**
3. OS/Architecture: Linux/X86_64
4. CPU: **0.5 vCPU**
5. Memory: **1 GB**
6. Task role: `auradesk-ecs-task-role`
7. Task execution role: `auradesk-ecs-execution-role`

**Add container:**
- Container name: `api`
- Image URI: `<ecr-account-id>.dkr.ecr.ap-south-1.amazonaws.com/auradesk-prod/api:latest`
- Port mappings: `3000` (TCP)
- Environment variables: set `NODE_ENV=production`
- Secrets (from Secrets Manager):
  - `DATABASE_URL` → `auradesk/prod/config:DATABASE_URL`
  - `REDIS_URL` → `auradesk/prod/config:REDIS_URL`
  - (add all secrets from Step 8)
- Log configuration:
  - Log driver: `awslogs`
  - Log group: `/auradesk/prod/api`
  - Region: `ap-south-1`
  - Stream prefix: `api`

Health check: `CMD-SHELL, curl -f http://localhost:3000/health || exit 1`

Repeat for webhook (port 3001) and worker (no port mapping).

---

### Step 13 — Create Application Load Balancer

1. Go to **EC2 → Load Balancers → Create load balancer → Application Load Balancer**
2. Name: `auradesk-prod-alb` / `auradesk-test-alb`
3. Scheme: **Internet-facing**
4. IP address type: IPv4
5. VPC: select correct VPC
6. Subnets: select **both public subnets** (AZ-A and AZ-B)
7. Security group: `auradesk-alb-sg`

**Listeners:**
- HTTP 80: redirect to HTTPS 443
- HTTPS 443: forward to target group (create below)

**Create Target Groups:**

Target group for API:
1. Target type: **IP** (required for Fargate)
2. Name: `auradesk-prod-api-tg`
3. Protocol: HTTP | Port: 3000
4. Health check path: `/health`
5. Healthy threshold: 2 | Unhealthy threshold: 3

Target group for Webhook:
- Same but name `auradesk-prod-webhook-tg`, port 3001, health path `/webhooks/health`

**HTTPS Listener Rules** (in order):
1. If path is `/webhooks/*` → forward to `auradesk-prod-webhook-tg`
2. If path is `/api/*` → forward to `auradesk-prod-api-tg`
3. Default → 404

**SSL Certificate:**
1. Go to **ACM → Request certificate**
2. Request public certificate
3. Domain: `yourdomain.com` and `*.yourdomain.com`
4. Validation: DNS validation
5. Add the CNAME records to your DNS
6. Wait for validation (~5 mins)
7. Attach to ALB HTTPS listener

---

### Step 14 — Create ECS Services

Go to **ECS → Clusters → auradesk-prod-cluster → Services → Create**

**API Service:**
1. Launch type: **Fargate**
2. Task definition: `auradesk-prod-api` (latest)
3. Service name: `auradesk-prod-api`
4. Desired tasks: **2** (prod) | **1** (test)
5. VPC: select correct VPC
6. Subnets: select **both private ECS subnets**
7. Security group: `auradesk-ecs-sg`
8. Public IP: **Off**
9. Load balancing: select your ALB → select `auradesk-prod-api-tg`
10. Auto scaling:
    - Minimum: 1 | Maximum: 10
    - Scale out: CPU > 60% for 2 minutes
    - Scale in: CPU < 30% for 5 minutes

**Webhook Service:** Same but task definition `auradesk-prod-webhook`, target group `auradesk-prod-webhook-tg`, min 1 / max 4.

**Worker Service:** Same but task definition `auradesk-prod-worker`, no load balancing, scale on SQS metric.

---

### Step 15 — Route 53 DNS Configuration

1. Go to **Route 53 → Hosted zones → Create hosted zone**
2. Domain name: `yourdomain.com`
3. Type: **Public**
4. Create these records:

| Name | Type | Value |
|---|---|---|
| `yourdomain.com` | A (Alias) | Alias to prod ALB |
| `test.yourdomain.com` | A (Alias) | Alias to test ALB |

5. Copy the NS records from Route 53 and update your domain registrar to use Route 53 nameservers

---

### Step 16 — CloudFront for Frontend

1. Go to **CloudFront → Create distribution**
2. Origin: select `auradesk-prod-static` S3 bucket
3. Origin access: **Origin Access Control** (create new OAC)
4. Update S3 bucket policy when prompted
5. Viewer protocol policy: **Redirect HTTP to HTTPS**
6. Alternate domain names: `yourdomain.com`
7. SSL certificate: select the ACM certificate
8. Default root object: `index.html`
9. Custom error responses:
   - 403 → /index.html → 200 (required for React Router)
   - 404 → /index.html → 200

---

### Step 17 — Verify everything is working

Run through this checklist after all setup:

- [ ] VPC created with 6 subnets across 2 AZs
- [ ] NAT Gateways active in both public subnets
- [ ] All 4 security groups created with correct rules
- [ ] RDS PostgreSQL accessible from ECS SG, not from internet
- [ ] ElastiCache Redis accessible from ECS SG, not from internet
- [ ] Both S3 buckets created, public access blocked
- [ ] All 6 ECR repositories created
- [ ] SQS queue and DLQ created
- [ ] All secrets stored in Secrets Manager
- [ ] IAM roles created and attached
- [ ] ECS cluster created (Fargate mode)
- [ ] CloudWatch log groups created
- [ ] Task definitions created for all 3 services × 2 environments
- [ ] ALB created with correct listener rules
- [ ] ACM certificate issued and attached
- [ ] All 3 ECS services running (check tasks are in RUNNING state)
- [ ] Route 53 DNS records pointing to ALBs
- [ ] CloudFront distribution deployed
- [ ] Health check endpoints returning 200

---

## 8. CI/CD Pipeline

### 8.1 GitHub Secrets required

Add these to your GitHub repository → Settings → Secrets → Actions:

```
AWS_ACCESS_KEY_ID           # IAM user for GitHub Actions deployments
AWS_SECRET_ACCESS_KEY       # IAM user secret
AWS_REGION                  # ap-south-1

# Test environment
ECR_API_REPO_TEST           # ECR URI for test/api
ECR_WEBHOOK_REPO_TEST       # ECR URI for test/webhook
ECR_WORKER_REPO_TEST        # ECR URI for test/worker
ECS_CLUSTER_TEST            # auradesk-test-cluster
ECS_SERVICE_API_TEST        # auradesk-test-api
ECS_SERVICE_WEBHOOK_TEST    # auradesk-test-webhook
ECS_SERVICE_WORKER_TEST     # auradesk-test-worker

# Production environment
ECR_API_REPO_PROD           # ECR URI for prod/api
ECR_WEBHOOK_REPO_PROD       # ECR URI for prod/webhook
ECR_WORKER_REPO_PROD        # ECR URI for prod/worker
ECS_CLUSTER_PROD            # auradesk-prod-cluster
ECS_SERVICE_API_PROD        # auradesk-prod-api
ECS_SERVICE_WEBHOOK_PROD    # auradesk-prod-webhook
ECS_SERVICE_WORKER_PROD     # auradesk-prod-worker
```

### 8.2 deploy-test.yml

Triggers on merge to `test` branch. Builds all 3 images and deploys to test ECS cluster.

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
        id: login-ecr
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
          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_API_TEST }} \
            --force-new-deployment

          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_WEBHOOK_TEST }} \
            --force-new-deployment

          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --service ${{ secrets.ECS_SERVICE_WORKER_TEST }} \
            --force-new-deployment

      - name: Wait for deployments
        run: |
          aws ecs wait services-stable \
            --cluster ${{ secrets.ECS_CLUSTER_TEST }} \
            --services \
              ${{ secrets.ECS_SERVICE_API_TEST }} \
              ${{ secrets.ECS_SERVICE_WEBHOOK_TEST }} \
              ${{ secrets.ECS_SERVICE_WORKER_TEST }}
```

### 8.3 deploy-prod.yml

Triggers on merge to `main` branch. Same build steps, deploys to prod, then auto-tags.

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

      - name: Deploy to Production ECS
        run: |
          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_API_PROD }} \
            --force-new-deployment

          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_WEBHOOK_PROD }} \
            --force-new-deployment

          aws ecs update-service \
            --cluster ${{ secrets.ECS_CLUSTER_PROD }} \
            --service ${{ secrets.ECS_SERVICE_WORKER_PROD }} \
            --force-new-deployment

      - name: Wait for stable
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

## 9. Dockerfile Templates

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

## 10. Cost Estimate

Estimated monthly AWS costs for both environments at launch:

| Service | Test | Prod | Notes |
|---|---|---|---|
| ECS Fargate (3 services) | ~$15 | ~$40 | Scales with usage |
| RDS PostgreSQL | ~$15 | ~$50 | db.t3.micro vs db.t3.medium |
| ElastiCache Redis | ~$12 | ~$25 | Single vs with replica |
| ALB | ~$18 | ~$18 | Per environment |
| NAT Gateway | ~$32 | ~$64 | 1 per AZ in prod |
| S3 + CloudFront | ~$2 | ~$5 | Based on traffic |
| ECR | ~$1 | ~$2 | Image storage |
| Secrets Manager | ~$1 | ~$2 | Per secret/month |
| CloudWatch | ~$3 | ~$8 | Logs + metrics |
| Route 53 | ~$1 | ~$1 | Hosted zone |
| **Total estimate** | **~$100/mo** | **~$215/mo** | |

> Note: NAT Gateways are the highest single cost item. These can be reduced by using VPC endpoints for S3 and ECR (already accounted for with the S3 VPC endpoint in Step 1). As traffic grows, costs scale. Review monthly.

---

## 11. Rollback Procedure

If a production deployment causes issues:

**Quick rollback (< 5 minutes)**

1. Go to **ECS → Clusters → auradesk-prod-cluster → Services**
2. Select the affected service
3. Click **Update service**
4. Under Task definition, select the **previous revision**
5. Click **Update** — ECS rolls back with zero downtime

**Git rollback**

```bash
# Find the last stable tag
git tag --sort=-v:refname | head -5

# Trigger a deploy of a specific version by pushing a revert commit to main
git revert HEAD
git push origin main
# GitHub Actions deploys the reverted code
```

---

## 12. Monitoring & Alerts

After setup, configure these CloudWatch alarms via the console:

| Alarm | Metric | Threshold | Action |
|---|---|---|---|
| High CPU | ECS CPU utilisation | > 80% for 5 min | SNS email to Mehul |
| Task failures | ECS task count | < desired for 2 min | SNS email to Mehul |
| RDS connections | DatabaseConnections | > 80 | SNS email to Mehul |
| SQS DLQ messages | ApproximateNumberOfMessages | > 0 | SNS email to Mehul |
| ALB 5xx errors | HTTPCode_Target_5XX_Count | > 10 per minute | SNS email to Mehul |
| RDS free storage | FreeStorageSpace | < 5 GB | SNS email to Mehul |

Create an SNS topic `auradesk-alerts`, subscribe Mehul's email, and attach to all alarms.

---

*AuraDesk Infrastructure Plan v1.0 — Slasheasy*
