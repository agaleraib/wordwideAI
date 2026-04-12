# Postgres + pgvector LXC — Dedicated Database Container for FinFlow

**Date:** 2026-04-12
**Status:** Draft
**Branch:** N/A (infrastructure, not application code)
**Owners:** Albert Galera (decisions), Claude (drafting)
**Depends on:**
- `2026-04-07-deployment-stack.md` — locked stack (Postgres 16 + pgvector + Drizzle ORM)
- `2026-04-12-editorial-memory.md` — first consumer (Phase 3, Task 10 migration ready)

---

## 1. Goal

Provision a dedicated Postgres 16 + pgvector LXC container on Proxmox node0 to replace the in-memory stores that FinFlow currently uses. This is the single Postgres instance for all FinFlow development, staging, and production workloads on the internal infrastructure.

**What this unlocks:**

1. **Editorial memory Phase 3** — the Drizzle migration at `packages/api/drizzle/0000_tense_energizer.sql` (3 tables, HNSW vector index) can be applied immediately.
2. **Repository pattern switchover** — `ProfileStore` and `TranslationStore` interfaces get Drizzle-backed implementations against real Postgres instead of `InMemoryProfileStore` / `InMemoryTranslationStore`.
3. **Content uniqueness** — cosine-similarity lookups over `finflow_news_items` embeddings require pgvector from day one (per deployment stack spec).
4. **Full schema rollout** — the 9 tables from `docs/architecture-plan.md` section 7 can be migrated incrementally as workstreams ship.

**What this is NOT:**

This is not the production deployment described in the deployment stack spec (Docker Compose on a cloud VM). This is the internal dev/staging/prod database for the current Proxmox-hosted infrastructure. The Docker Compose production deployment will provision its own Postgres — this container serves the pre-cloud phase.

---

## 2. Prior Work

Builds on: [FinFlow Deployment Stack](2026-04-07-deployment-stack.md)
Assumes: Postgres 16 + pgvector, Drizzle ORM, Ubuntu 24.04 LTS, `pg_dump` backup strategy, repository pattern over storage interfaces.
Changes: Nothing. This spec implements the database layer that the deployment stack spec specifies but does not provision.

Builds on: [Editorial Memory System](2026-04-12-editorial-memory.md)
Assumes: Drizzle schema at `packages/api/src/db/schema/editorial-memory.ts`, generated migration at `packages/api/drizzle/0000_tense_energizer.sql`.
Changes: Nothing. This spec provides the Postgres instance that Phase 3 requires.

---

## 3. LXC Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| **LXC ID** | 230 | Matches IP .230 for easy identification. CT 102 was already in use |
| **Hostname** | `pg-finflow` | Clear purpose, matches internal convention |
| **OS template** | Ubuntu 24.04 LTS (`ubuntu-24.04-standard_24.04-2_amd64.tar.zst`) | Per deployment stack spec |
| **CPU** | 2 cores | Sufficient for Postgres 16 with low-concurrency workloads (single dev + one app server). pgvector HNSW builds are CPU-bound but infrequent |
| **RAM** | 4 GB | Breakdown below |
| **Swap** | 1 GB | Safety valve for HNSW index builds on larger datasets |
| **Root disk** | 16 GB on local-zfs | OS + Postgres binaries + pg_dump temp space |
| **Data disk** | 32 GB ZFS dataset mounted at `/var/lib/postgresql` | Table data, WAL, indexes. Postgres creates `16/main/` under this mount. 32 GB is generous for tens of thousands of rows with 1536-dim vectors. Expandable via ZFS |
| **Nesting** | Off | Not needed for Postgres |
| **Keyctl** | Off | Not needed |
| **Unprivileged** | Yes | Standard security practice |
| **Start on boot** | Yes | Database must survive node0 reboots |

### RAM budget (4 GB)

| Component | Allocation | Notes |
|-----------|-----------|-------|
| `shared_buffers` | 1 GB | 25% of RAM, Postgres best practice |
| `effective_cache_size` | 2.5 GB | Postgres uses this for query planning, not allocation |
| `work_mem` | 64 MB | Per-sort/hash. Low concurrency means few simultaneous sorts |
| `maintenance_work_mem` | 256 MB | For VACUUM, CREATE INDEX, HNSW builds |
| OS + Postgres processes | ~512 MB | Remainder |

---

## 4. Networking

| Parameter | Value |
|-----------|-------|
| **Static IP** | `10.1.10.230` |
| **Subnet** | `10.1.10.0/24` |
| **Gateway** | `10.1.10.1` (UniFi gateway) |
| **DNS** | `10.1.10.1` or `1.1.1.1` (for apt updates only) |
| **Bridge** | `vmbr0` (same as CT 101) |

**Known IPs on subnet:**
- `10.1.10.1` — UniFi gateway
- `10.1.10.222` — Mac Studio
- `10.1.10.225` — CT 101 (playground)
- `10.1.10.233` — referenced in legacy docs (Supabase, likely unused — verify before provisioning)

**IP choice rationale:** `10.1.10.230` is in the .230 range, away from both the Mac Studio (.222) and CT 101 (.225), leaving room for future containers in the .226-.229 range. Verify .230 is free before provisioning.

### Firewall rules

Port 5432 is accessible only from trusted hosts. No public internet exposure.

**Inbound to CT 230 (10.1.10.230):**

| Source | Port | Protocol | Action |
|--------|------|----------|--------|
| 10.1.10.222 (Mac Studio) | 5432 | TCP | Allow |
| 10.1.10.225 (CT 101) | 5432 | TCP | Allow |
| 192.168.3.0/24 (WireGuard VPN) | 5432 | TCP | Deny |
| 0.0.0.0/0 | 5432 | TCP | Deny |

**Outbound from CT 230:** Allow TCP 80/443 to any (apt updates only). No other outbound needed.

Firewall is enforced at **two layers**:
1. **UniFi firewall** — LAN rules restricting access to .230:5432
2. **pg_hba.conf** — Postgres-level host-based auth (see section 6)

### WireGuard

No direct VPN access to the database. Testers on the WireGuard VPN (`192.168.3.0/24`) access the FinFlow API on CT 101, which connects to Postgres on CT 230. The database is never directly reachable from the VPN.

### Internal hostname (optional)

Add to `/etc/hosts` on Mac Studio and CT 101:
```
10.1.10.230  pg-finflow
```

No DNS server required. A `/etc/hosts` entry is sufficient for two consumers.

---

## 5. Postgres Configuration

### 5.1 Version and extensions

- **PostgreSQL 16** from the official PGDG apt repository (not Ubuntu's packaged version, which may lag)
- **pgvector** — installed from `pgdg` or built from source. `CREATE EXTENSION IF NOT EXISTS vector` must succeed in both databases

### 5.2 Databases

| Database | Purpose | Disposable? | Backup? |
|----------|---------|-------------|---------|
| `finflow_dev` | Development + staging. Migrations tested here first. Safe to wipe/recreate. | Yes | No |
| `finflow_prod` | Production. Migrations applied only after dev validation. | No | Yes (nightly) |

Both databases must have pgvector enabled:
```sql
\c finflow_dev
CREATE EXTENSION IF NOT EXISTS vector;

\c finflow_prod
CREATE EXTENSION IF NOT EXISTS vector;
```

### 5.3 Roles

| Role | Databases | Privileges | Password | Purpose |
|------|-----------|------------|----------|---------|
| `finflow_admin` | all | SUPERUSER | strong, stored in gobot/.env | Maintenance, extensions, role management |
| `finflow_dev` | `finflow_dev` | ALL (DDL + DML) on `finflow_dev` | stored in gobot/.env | Dev/staging — full schema control |
| `finflow_app` | `finflow_prod` | DML only (SELECT, INSERT, UPDATE, DELETE) on all tables in `public` schema | stored in gobot/.env | App runtime — cannot alter schema |
| `finflow_migrate` | `finflow_prod` | DDL + DML on `public` schema | stored in gobot/.env | Migration runner only — used by `drizzle-kit migrate` |

**Role creation SQL:**
```sql
-- Run as postgres superuser
CREATE ROLE finflow_admin WITH LOGIN SUPERUSER PASSWORD 'CHANGE_ME';
CREATE ROLE finflow_dev WITH LOGIN PASSWORD 'CHANGE_ME';
CREATE ROLE finflow_app WITH LOGIN PASSWORD 'CHANGE_ME';
CREATE ROLE finflow_migrate WITH LOGIN PASSWORD 'CHANGE_ME';

CREATE DATABASE finflow_dev OWNER finflow_dev;
CREATE DATABASE finflow_prod OWNER finflow_admin;

-- finflow_dev gets full control of their database (automatic via OWNER)

-- finflow_prod: grant schema usage + DML to app role
\c finflow_prod
GRANT USAGE ON SCHEMA public TO finflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE finflow_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE finflow_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO finflow_app;

-- finflow_migrate gets DDL on finflow_prod
GRANT ALL ON SCHEMA public TO finflow_migrate;
```

### 5.4 Connection strings

Add to `gobot/.env` (or `packages/api/.env` if the project gets its own env file):

```env
# Postgres — CT 230 (pg-finflow / 10.1.10.230)
DATABASE_URL_DEV=postgresql://finflow_dev:PASSWORD@10.1.10.230:5432/finflow_dev
DATABASE_URL=postgresql://finflow_app:PASSWORD@10.1.10.230:5432/finflow_prod
DATABASE_URL_MIGRATE=postgresql://finflow_migrate:PASSWORD@10.1.10.230:5432/finflow_prod
DATABASE_URL_ADMIN=postgresql://finflow_admin:PASSWORD@10.1.10.230:5432/postgres
```

**Convention:**
- `DATABASE_URL_DEV` — used by `bun run dev` on Mac Studio and by CT 101 in staging mode
- `DATABASE_URL` — used by the production app on CT 101
- `DATABASE_URL_MIGRATE` — used by `bunx drizzle-kit migrate` against prod (elevated privileges)
- `DATABASE_URL_ADMIN` — maintenance only, never in app config

### 5.5 postgresql.conf tuning

```conf
# Memory
shared_buffers = 1GB
effective_cache_size = 2560MB
work_mem = 64MB
maintenance_work_mem = 256MB

# WAL
wal_level = replica                  # enables pg_basebackup if needed later
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_completion_target = 0.9

# Connections
max_connections = 50                 # low concurrency; 2 app servers + dev + admin
listen_addresses = '10.1.10.230'     # bind to LAN IP only, not 0.0.0.0

# Logging
log_min_duration_statement = 500     # log queries > 500ms
log_statement = 'ddl'               # log all DDL (CREATE, ALTER, DROP)
log_connections = on
log_disconnections = on

# pgvector
# HNSW index build is CPU-bound; maintenance_work_mem controls memory during build
# No pgvector-specific GUCs needed at this scale
```

### 5.6 pg_hba.conf

```conf
# TYPE  DATABASE        USER             ADDRESS              METHOD

# Local socket — admin only
local   all             finflow_admin                          scram-sha-256
local   all             postgres                               peer

# Mac Studio (development)
host    finflow_dev     finflow_dev      10.1.10.222/32       scram-sha-256
host    finflow_prod    finflow_migrate  10.1.10.222/32       scram-sha-256
host    finflow_prod    finflow_app      10.1.10.222/32       scram-sha-256
host    all             finflow_admin    10.1.10.222/32       scram-sha-256

# CT 101 (playground / staging / production app)
host    finflow_dev     finflow_dev      10.1.10.225/32       scram-sha-256
host    finflow_prod    finflow_app      10.1.10.225/32       scram-sha-256
host    all             finflow_admin    10.1.10.225/32       scram-sha-256

# Deny everything else (implicit, but explicit for clarity)
host    all             all              0.0.0.0/0            reject
```

---

## 6. Storage

### 6.1 ZFS datasets

```
rpool/data/ct230-rootfs          16 GB   → LXC root filesystem
rpool/data/ct230-pgdata          32 GB   → /var/lib/postgresql/16/main
```

**Option A — ZFS dataset as bind mount:** Create a ZFS dataset on node0, bind-mount into the LXC at `/var/lib/postgresql/16/main`. This gives node0-level snapshot control without requiring ZFS inside the unprivileged LXC.

**Option B — LXC root on ZFS (simpler):** If CT 230's root is already on `local-zfs`, then `/var/lib/postgresql/16/main` is automatically on ZFS. Separate dataset is optional but recommended for independent snapshot/quota control.

**Recommendation:** Option A. A separate dataset allows:
- Independent snapshots of the data directory without snapshotting the OS
- Independent quota (prevent a runaway table from filling the root disk)
- Easy migration: `zfs send` the dataset to a new host

### 6.2 Snapshot strategy

| Trigger | Dataset | Retention | Purpose |
|---------|---------|-----------|---------|
| Before every migration | `ct230-pgdata` | Keep last 5 | Rollback point if migration breaks |
| Nightly (cron, 02:00) | `ct230-pgdata` | Keep last 7 | Point-in-time recovery |
| Manual (before risky ops) | `ct230-pgdata` | Manual cleanup | Safety net |

Snapshots are taken from **node0** (the Proxmox host), not from inside the LXC:
```bash
# From node0
zfs snapshot rpool/data/ct230-pgdata@pre-migration-$(date +%Y%m%d-%H%M%S)
```

### 6.3 Separate WAL partition

Not warranted at this scale. WAL stays on the same dataset as table data. The 32 GB allocation and `max_wal_size = 2GB` provide sufficient headroom. Revisit if write volume increases significantly.

---

## 7. Backup

### 7.1 Policy

| Database | Backed up? | Method | Schedule | Retention |
|----------|-----------|--------|----------|-----------|
| `finflow_prod` | Yes | `pg_dump` (custom format) | Nightly, 03:00 | 7 daily |
| `finflow_dev` | No | — | — | Disposable by design |

### 7.2 Backup destination

Dumps are stored locally on CT 230 at `/var/backups/finflow/` (7-day retention). Optionally pulled to the Mac Studio (path TBD — see open question #3) or S3-compatible storage. Pulls are preferred over pushes to avoid giving the database container write access to the backup host.

Alternative (future): S3-compatible storage (Backblaze B2, Hetzner Object Storage). Not needed until cloud deployment.

### 7.3 Backup script

Runs inside CT 230 via systemd timer:

```bash
#!/bin/bash
# /usr/local/bin/finflow-backup.sh
set -euo pipefail

BACKUP_DIR="/var/backups/finflow"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
DUMP_FILE="${BACKUP_DIR}/finflow_prod_${TIMESTAMP}.dump"

mkdir -p "$BACKUP_DIR"

# Runs as OS user 'postgres' with peer auth — no password needed
pg_dump -Fc finflow_prod > "$DUMP_FILE"

# Prune: keep last 7 daily
ls -1t "${BACKUP_DIR}"/finflow_prod_*.dump | tail -n +8 | xargs -r rm --

echo "Backup complete: ${DUMP_FILE} ($(du -h "$DUMP_FILE" | cut -f1))"
```

Optionally, a separate rsync timer on the Mac Studio pulls `/var/backups/finflow/` from CT 230 nightly at 03:30 (destination path TBD — see open question #3).

### 7.4 Systemd timer

```ini
# /etc/systemd/system/finflow-backup.timer
[Unit]
Description=Nightly pg_dump of finflow_prod

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```ini
# /etc/systemd/system/finflow-backup.service
[Unit]
Description=pg_dump finflow_prod

[Service]
Type=oneshot
ExecStart=/usr/local/bin/finflow-backup.sh
User=postgres
```

### 7.5 Restore verification

Monthly (manual): restore the latest dump to `finflow_dev` and verify the app can connect and query:

```bash
pg_restore -U finflow_admin -d finflow_dev --clean --if-exists /var/backups/finflow/finflow_prod_LATEST.dump
```

---

## 8. Access Policy Summary

| Source | Target DB | Role | Use case |
|--------|-----------|------|----------|
| Mac Studio (10.1.10.222) | `finflow_dev` | `finflow_dev` | Development: `bun run dev`, Drizzle Studio, psql |
| Mac Studio (10.1.10.222) | `finflow_prod` | `finflow_migrate` | Running `bunx drizzle-kit migrate` against prod |
| Mac Studio (10.1.10.222) | `finflow_prod` | `finflow_app` | Local testing against prod data (read-heavy) |
| CT 101 (10.1.10.225) | `finflow_dev` | `finflow_dev` | Staging mode |
| CT 101 (10.1.10.225) | `finflow_prod` | `finflow_app` | Production mode |
| WireGuard VPN (192.168.3.0/24) | — | — | No direct DB access. Testers hit CT 101 API only |
| Internet | — | — | No access |

---

## 9. Decision Point: Postgres MCP Server

**Deferred to implementation plan.** This section documents the tradeoff for a future decision.

### What it is

A Postgres MCP (Model Context Protocol) server that lets Claude Code query and administer the database directly from the IDE. Examples: [supabase/mcp-server-postgres](https://github.com/supabase-community/mcp-server-postgres), [benborla29/mcp-server-postgres](https://github.com/benborla29/mcp-server-postgres).

### Pros

- **Faster iteration:** Claude Code can inspect schema, run queries, debug data issues without switching to psql
- **Migration verification:** Claude Code can verify migrations applied correctly by querying the actual tables
- **Schema exploration:** when writing Drizzle queries, Claude Code can check what indexes exist, what constraints are in place
- **Zero context-switching:** stays in the IDE for everything

### Cons

- **Security surface:** another process with DB credentials. Mitigated by connecting to `finflow_dev` only
- **Accidental mutations:** a poorly-formed query from the IDE could modify data. Mitigated by read-only role or `finflow_dev` only
- **Dependency:** MCP servers are still young; may have compatibility issues with Claude Code updates
- **Not needed for prod:** prod is managed by Drizzle migrations and the app. IDE access to prod is an anti-pattern

### If installed

- Connect to `finflow_dev` only — never `finflow_prod`
- Use the `finflow_dev` role (full DDL+DML on dev, no prod access)
- Configure in `.claude/settings.json` MCP servers block
- Add to CLAUDE.md so future sessions know it is available

### Decision

Deferred. Install during implementation if it proves useful during the editorial memory Phase 3 migration work. Do not block provisioning on this.

---

## 10. Requirements

### Phase 1: LXC Provisioning

**Acceptance criteria:**

- [ ] CT 230 exists on Proxmox node0 with hostname `pg-finflow`, Ubuntu 24.04 LTS, 2 cores, 4 GB RAM, 1 GB swap
- [ ] CT 230 has static IP `10.1.10.230` on `vmbr0` (or confirmed alternative if .230 is taken)
- [ ] CT 230 starts on boot (`onboot: 1`)
- [ ] `apt update && apt upgrade` completes without errors from inside CT 230
- [ ] ZFS dataset for pgdata exists as a separate dataset or bind mount at `/var/lib/postgresql/16/main`

### Phase 2: Postgres + pgvector Installation

**Acceptance criteria:**

- [ ] `psql --version` returns `psql (PostgreSQL) 16.x`
- [ ] `CREATE EXTENSION IF NOT EXISTS vector` succeeds in both `finflow_dev` and `finflow_prod`
- [ ] All 4 roles exist (`finflow_admin`, `finflow_dev`, `finflow_app`, `finflow_migrate`) with correct privileges
- [ ] `pg_hba.conf` restricts access per section 5.6 — connection from Mac Studio to `finflow_dev` as `finflow_dev` succeeds; connection from any other IP is rejected
- [ ] `postgresql.conf` tuning matches section 5.5 (verify with `SHOW shared_buffers; SHOW effective_cache_size; SHOW work_mem;`)
- [ ] Postgres listens on `10.1.10.230:5432` only (not `0.0.0.0`)
- [ ] Error case: connection from an unauthorized IP (e.g., `10.1.10.100`) to port 5432 is rejected at both firewall and pg_hba level

### Phase 3: Firewall + Networking

**Acceptance criteria:**

- [ ] UniFi firewall rule exists: allow TCP 5432 from 10.1.10.222 and 10.1.10.225 to 10.1.10.230
- [ ] UniFi firewall rule exists: deny TCP 5432 from all other sources to 10.1.10.230
- [ ] `/etc/hosts` on Mac Studio contains `10.1.10.230 pg-finflow`
- [ ] `/etc/hosts` on CT 101 contains `10.1.10.230 pg-finflow`
- [ ] `psql -h pg-finflow -U finflow_dev -d finflow_dev -c 'SELECT 1'` succeeds from Mac Studio
- [ ] `psql -h pg-finflow -U finflow_app -d finflow_prod -c 'SELECT 1'` succeeds from CT 101

### Phase 4: Backup + Snapshots

**Acceptance criteria:**

- [ ] `/usr/local/bin/finflow-backup.sh` exists and is executable on CT 230
- [ ] `finflow-backup.timer` is enabled and active (`systemctl is-active finflow-backup.timer`)
- [ ] Manual run of `finflow-backup.sh` produces a dump file in `/var/backups/finflow/`
- [ ] Dump file restores cleanly: `pg_restore -U finflow_admin -d finflow_dev --clean --if-exists <dump>` succeeds
- [ ] ZFS snapshot of pgdata dataset can be created from node0: `zfs snapshot rpool/data/ct230-pgdata@test` succeeds
- [ ] Pruning logic works: create 10 dummy dumps, run backup, verify only 7 remain

### Phase 5: Smoke Test — Editorial Memory Migration

**Acceptance criteria:**

- [ ] From Mac Studio: `DATABASE_URL_DEV=postgresql://finflow_dev:PASSWORD@pg-finflow:5432/finflow_dev bunx drizzle-kit migrate` applies the editorial memory migration (`0000_tense_energizer.sql`) without errors
- [ ] `\dt` in `finflow_dev` shows `editorial_facts`, `editorial_contradictions`, `editorial_piece_logs`
- [ ] `\di` shows the HNSW index `idx_facts_embedding_hnsw` on `editorial_facts.embedding`
- [ ] Insert a test row with a 1536-dim vector: `INSERT INTO editorial_facts (tenant_id, topic_id, piece_id, fact_type, content, embedding, confidence, valid_from, source_event_id, extraction_model, extraction_cost_usd) VALUES ('test', 'eurusd', 'piece-1', 'position', 'test fact', ('[' || (SELECT string_agg('0.01', ',') FROM generate_series(1,1536)) || ']')::vector, 'high', now(), 'evt-1', 'test', 0.001)` succeeds
- [ ] Cosine similarity query works: `SELECT id, content, embedding <=> (SELECT embedding FROM editorial_facts LIMIT 1) AS distance FROM editorial_facts ORDER BY distance LIMIT 5` returns results
- [ ] Drop and recreate: `DROP TABLE IF EXISTS editorial_piece_logs, editorial_contradictions, editorial_facts CASCADE` succeeds, re-running migration succeeds

---

## 11. Implementation Plan (Sprint Contracts)

### Phase 1: LXC Creation

- [ ] **Task 1:** Create CT 230 on Proxmox node0
  - **Files:** N/A (Proxmox CLI / web UI)
  - **Depends on:** Nothing
  - **Steps:**
    1. Verify `10.1.10.230` is free: `ping -c 3 10.1.10.230` should fail
    2. Verify `10.1.10.233` status (legacy Supabase reference) — reclaim if unused
    3. Download Ubuntu 24.04 template if not cached: `pveam download local ubuntu-24.04-standard_24.04-2_amd64.tar.zst`
    4. Create container:
       ```bash
       pct create 230 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
         --hostname pg-finflow \
         --cores 2 \
         --memory 4096 \
         --swap 1024 \
         --rootfs local-zfs:16 \
         --net0 name=eth0,bridge=vmbr0,ip=10.1.10.230/24,gw=10.1.10.1 \
         --onboot 1 \
         --unprivileged 1 \
         --features nesting=0
       ```
    5. Create separate ZFS dataset for pgdata:
       ```bash
       zfs create -o mountpoint=none rpool/data/ct230-pgdata
       # Add as bind mount to CT 230 config
       pct set 230 -mp0 /rpool/data/ct230-pgdata,mp=/var/lib/postgresql
       ```
    6. Start CT 230: `pct start 230`
    7. Enter CT 230: `pct enter 230`
    8. Run `apt update && apt upgrade -y`
  - **Verify:** `pct status 230` shows `running`. `pct exec 230 -- hostname` returns `pg-finflow`. `pct exec 230 -- ip addr show eth0` shows `10.1.10.230/24`.

- [ ] **Task 2:** Configure ZFS dataset and verify mount
  - **Files:** N/A (Proxmox host)
  - **Depends on:** Task 1
  - **Steps:**
    1. From node0, verify dataset: `zfs list | grep ct230`
    2. Inside CT 230: `df -h /var/lib/postgresql` shows the mount
    3. Test snapshot from node0: `zfs snapshot rpool/data/ct230-pgdata@initial`
    4. Verify snapshot: `zfs list -t snapshot | grep ct230`
  - **Verify:** ZFS dataset exists, is mounted inside CT 230 at `/var/lib/postgresql`, and a snapshot can be created from node0.

### Phase 2: Postgres + pgvector

- [ ] **Task 3:** Install PostgreSQL 16 from PGDG repository
  - **Files:** N/A (inside CT 230)
  - **Depends on:** Task 1
  - **Steps:**
    1. Inside CT 230:
       ```bash
       apt install -y curl ca-certificates gnupg
       curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg
       echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
       apt update
       apt install -y postgresql-16
       ```
    2. Verify: `psql --version` shows 16.x
    3. Verify service: `systemctl status postgresql@16-main`
  - **Verify:** `psql -U postgres -c 'SELECT version()'` returns PostgreSQL 16.x.

- [ ] **Task 4:** Install pgvector extension
  - **Files:** N/A (inside CT 230)
  - **Depends on:** Task 3
  - **Steps:**
    1. Install build deps and pgvector:
       ```bash
       apt install -y postgresql-16-pgvector
       ```
       If `postgresql-16-pgvector` is not in PGDG, build from source:
       ```bash
       apt install -y build-essential postgresql-server-dev-16 git
       cd /tmp
       git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
       cd pgvector
       make
       make install
       ```
    2. Verify: `psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname = 'vector';"`
  - **Verify:** `CREATE EXTENSION IF NOT EXISTS vector` succeeds. Extension version is 0.7+ (HNSW support).

- [ ] **Task 5:** Apply postgresql.conf and pg_hba.conf tuning
  - **Files:** `/etc/postgresql/16/main/postgresql.conf`, `/etc/postgresql/16/main/pg_hba.conf`
  - **Depends on:** Task 3
  - **Steps:**
    1. Edit `postgresql.conf` per section 5.5
    2. Replace `pg_hba.conf` per section 5.6
    3. Restart Postgres: `systemctl restart postgresql@16-main`
    4. Verify settings: `psql -U postgres -c "SHOW shared_buffers; SHOW effective_cache_size; SHOW work_mem; SHOW listen_addresses;"`
  - **Verify:** All SHOW commands return expected values. `listen_addresses` is `10.1.10.230`. `ss -tlnp | grep 5432` shows binding on `10.1.10.230:5432` only.

- [ ] **Task 6:** Create roles and databases
  - **Files:** N/A (SQL commands)
  - **Depends on:** Tasks 4, 5
  - **Steps:**
    1. Generate 4 strong passwords (32-char random)
    2. Run role creation SQL from section 5.3 (substituting real passwords)
    3. Enable pgvector in both databases
    4. Store all 4 passwords in `gobot/.env` with the variable names from section 5.4
    5. Test each connection string with psql
  - **Verify:** All 4 connection strings from section 5.4 work when tested with `psql`. `finflow_dev` can CREATE TABLE in `finflow_dev`. `finflow_app` can SELECT but NOT CREATE TABLE in `finflow_prod`. `finflow_migrate` can CREATE TABLE in `finflow_prod`.

### Phase 3: Firewall + DNS

- [ ] **Task 7:** Configure UniFi firewall rules
  - **Files:** N/A (UniFi Controller UI)
  - **Depends on:** Task 1
  - **Steps:**
    1. In UniFi Network → Settings → Firewall & Security → LAN Rules:
       - Rule 1: Allow TCP 5432 from 10.1.10.222 to 10.1.10.230
       - Rule 2: Allow TCP 5432 from 10.1.10.225 to 10.1.10.230
       - Rule 3: Deny TCP 5432 from any to 10.1.10.230 (lower priority)
    2. Test: from Mac Studio, `nc -zv 10.1.10.230 5432` succeeds
    3. Test: from another device on the LAN, `nc -zv 10.1.10.230 5432` fails
  - **Verify:** Port 5432 reachable from .222 and .225 only.

- [ ] **Task 8:** Add /etc/hosts entries
  - **Files:** `/etc/hosts` on Mac Studio, `/etc/hosts` on CT 101
  - **Depends on:** Task 1
  - **Steps:**
    1. On Mac Studio: `echo '10.1.10.230  pg-finflow' | sudo tee -a /etc/hosts`
    2. On CT 101: `echo '10.1.10.230  pg-finflow' | tee -a /etc/hosts` (as root)
    3. Test: `ping -c 1 pg-finflow` from both hosts resolves to 10.1.10.230
  - **Verify:** `psql -h pg-finflow -U finflow_dev -d finflow_dev -c 'SELECT 1'` succeeds from Mac Studio.

### Phase 4: Backup

- [ ] **Task 9:** Set up backup script and systemd timer
  - **Files:** `/usr/local/bin/finflow-backup.sh`, `/etc/systemd/system/finflow-backup.service`, `/etc/systemd/system/finflow-backup.timer` (all on CT 230)
  - **Depends on:** Task 6
  - **Steps:**
    1. Create backup directory: `mkdir -p /var/backups/finflow && chown postgres:postgres /var/backups/finflow`
    2. Install backup script from section 7.3
    3. Install systemd service and timer from section 7.4
    4. Enable timer: `systemctl enable --now finflow-backup.timer`
    5. Test: `systemctl start finflow-backup.service` (manual trigger)
    6. Verify dump file exists and is non-empty
    7. Test restore: `pg_restore -U finflow_admin -d finflow_dev --clean --if-exists /var/backups/finflow/finflow_prod_*.dump`
  - **Verify:** Timer is active. Manual backup produces a valid dump. Restore to dev succeeds.

- [ ] **Task 10:** Set up ZFS snapshot cron on node0
  - **Files:** `/etc/cron.d/finflow-zfs-snapshots` on node0
  - **Depends on:** Task 2
  - **Steps:**
    1. Create cron file on node0:
       ```
       # /etc/cron.d/finflow-zfs-snapshots
       0 2 * * * root zfs snapshot rpool/data/ct230-pgdata@nightly-$(date +\%Y\%m\%d) && zfs list -t snapshot -o name -s creation | grep 'ct230-pgdata@nightly-' | head -n -7 | xargs -r -n1 zfs destroy
       ```
    2. Test: run the command manually, verify snapshot appears in `zfs list -t snapshot`
  - **Verify:** Nightly snapshot cron exists. Manual run creates a snapshot. Old snapshots (beyond 7) are pruned.

### Phase 5: Smoke Test

- [ ] **Task 11:** Run editorial memory migration against finflow_dev
  - **Files:** `packages/api/drizzle/0000_tense_energizer.sql`, `packages/api/drizzle.config.ts`
  - **Depends on:** Tasks 6, 8
  - **Steps:**
    1. From Mac Studio, cd to `packages/api`
    2. Set `DATABASE_URL` to the dev connection string
    3. Run: `bunx drizzle-kit migrate`
    4. Connect with psql and verify:
       - `\dt` shows 3 tables
       - `\di` shows all indexes including `idx_facts_embedding_hnsw`
       - Insert a test vector row (1536-dim)
       - Run a cosine similarity query
    5. Drop everything: `DROP TABLE IF EXISTS editorial_piece_logs, editorial_contradictions, editorial_facts CASCADE; DROP EXTENSION vector;`
    6. Re-run migration to confirm idempotent apply
  - **Verify:** Migration applies cleanly. All 3 tables, all indexes (including HNSW), and FK constraints exist. Vector insert and cosine query succeed. Clean re-apply after drop succeeds.

- [ ] **Task 12:** End-to-end connectivity test from CT 101
  - **Files:** N/A
  - **Depends on:** Tasks 7, 8, 11
  - **Steps:**
    1. SSH into CT 101
    2. Install psql client if not present: `apt install -y postgresql-client-16`
    3. Test dev: `psql -h pg-finflow -U finflow_dev -d finflow_dev -c '\dt'` shows editorial memory tables
    4. Test prod (app role): `psql -h pg-finflow -U finflow_app -d finflow_prod -c 'SELECT 1'` succeeds
    5. Test prod (app role cannot DDL): `psql -h pg-finflow -U finflow_app -d finflow_prod -c 'CREATE TABLE test_fail (id int)'` fails with permission denied
  - **Verify:** CT 101 can connect to both databases with appropriate roles. App role cannot perform DDL on prod.

---

## 12. Constraints

- **Deployment stack spec is authoritative.** All decisions here must align with `2026-04-07-deployment-stack.md`.
- **No public internet exposure.** Port 5432 is LAN-only, firewalled at both UniFi and pg_hba levels.
- **Passwords never in git.** All credentials in `gobot/.env` or equivalent, gitignored.
- **CT 101 is untouched.** This spec does not modify CT 101's configuration beyond adding a `/etc/hosts` entry and optionally installing `postgresql-client-16`.
- **No Docker.** This is a bare-metal Postgres install inside an LXC, not Docker-in-LXC. Docker Compose deployment is for the future cloud phase.

---

## 13. Out of Scope

| Item | Why |
|------|-----|
| Full 9-table schema migration | Only editorial memory tables exist as Drizzle schema today. Other tables are migrated as their workstreams ship |
| Docker Compose deployment | That is the cloud production deployment. This spec covers the Proxmox LXC for internal infra |
| Read replicas / streaming replication | Single instance is sufficient for current scale |
| Connection pooling (PgBouncer) | 2 app servers + 1 dev machine = ~10 concurrent connections. Not needed |
| Automated failover / HA | Single Proxmox node. HA requires a second node |
| S3 backup destination | Local backup to Mac Studio is sufficient for now. S3 is a future enhancement |
| Monitoring / alerting (Prometheus postgres_exporter) | Useful but not blocking. Add when observability stack is set up |
| Postgres MCP server installation | Deferred per section 9 |

---

## 14. Open Questions

| # | Question | Impact | Decision needed by |
|---|----------|--------|-------------------|
| 1 | Is `10.1.10.233` (referenced as Supabase in legacy docs) still in use? If free, should we use .233 instead of .230 for continuity? | IP assignment only | Before Task 1 |
| 2 | Should `finflow_dev` on CT 101 use the same `finflow_dev` database as Mac Studio, or should there be a third database (`finflow_staging`)? | Shared dev DB means CT 101 staging and Mac Studio dev can step on each other. Separate staging DB adds complexity | Before CT 101 connects to Postgres |
| 3 | Where exactly on the Mac Studio should backup dumps land? `/srv/backups/pg-finflow/` assumes `/srv` exists | Backup destination path | Before Task 9 |
| 4 | Should the Drizzle config in `packages/api` read `DATABASE_URL` or `DATABASE_URL_DEV` by default? Convention is `DATABASE_URL` for production, but dev workflow needs the dev DB | Affects developer ergonomics | Before Task 11 |
| 5 | Retention policy for ZFS snapshots: 7 nightly is proposed. Should weekly snapshots also be kept (e.g., 4 weekly)? | Storage usage on node0 | Before Task 10 |
