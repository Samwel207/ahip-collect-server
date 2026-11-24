# Hosting the AHIP backend on an online server

This repository (`https://github.com/Samwel207/ahip-collect-server`) is the AHIP backend:
AHIP Manage and the files to host it. The phone app (AHIP Collect) is kept separately.

| What | Where |
| --- | --- |
| AHIP Manage server (accounts, forms designer, AI, API keys) | `server.js`, `mailer.js`, `lib/` |
| Admin web pages | `public/` |
| Create the first administrator | `tools/create-admin.js` |
| Hosting files | `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example` |

`docker compose` starts four containers: **caddy** (HTTPS, the only one open to the internet),
**dashboard** (AHIP Manage, built from this folder), **fhir** (HAPI FHIR server: forms and
submissions) and **postgres** (FHIR database).

## You need

- A Linux server (Ubuntu 22.04/24.04), at least 2 CPUs, 4 GB RAM, 40 GB disk.
- A domain name, for example `ahip.example.org`, with an **A record** pointing to the server's IP.
- Read access to the GitHub repository (the owner adds you as a collaborator).
- The Gemini API key, sent to you privately by the owner (never through GitHub or a chat group).

## Steps

1. **Prepare the server** (as a user with sudo):
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER   # then sign out and in again
   ```
2. **Get the code from GitHub**:
   ```bash
   sudo mkdir -p /opt/ahip && sudo chown $USER /opt/ahip && cd /opt/ahip
   git clone https://github.com/Samwel207/ahip-collect-server.git
   cd ahip-collect-server
   ```
   For a private repository, sign in with a GitHub personal access token (or set up an SSH deploy key).
3. **Create the settings file**:
   ```bash
   cp .env.example .env
   nano .env        # DOMAIN, a long random POSTGRES_PASSWORD, GEMINI_API_KEY
   chmod 600 .env
   ```
4. **Start everything**:
   ```bash
   docker compose up -d --build
   docker compose ps                 # all four should be "running"
   docker compose logs -f dashboard  # Ctrl+C to stop watching
   ```
   The FHIR server needs 1 to 2 minutes on first start. Caddy gets the HTTPS certificate on its own
   once the domain points to the server.
5. **Create the first administrator** (only possible on the server, by design):
   ```bash
   docker compose exec dashboard node tools/create-admin.js
   ```
   Then sign in at `https://<your domain>`.
6. **Load the forms and settings** in AHIP Manage: **Forms** → publish T1 to T6 (or upload the
   Excel files exported from the office server), then **Settings** → dashboard address
   `https://<your domain>` and the email (SMTP) settings for invitations.

## AHIP Collect Web and supervisors

- Data collectors with iPhones use `https://<your domain>/collect` (same username and password as the
  phone app). Over HTTPS the browser allows GPS and audio recording; photos work everywhere.
- In AHIP Manage > Users, the role **Supervisor** gives the home page and the Forms designer only;
  **Administrator** gives everything.

## Updating to a new version

```bash
cd /opt/ahip/ahip-collect-server && git pull
docker compose up -d --build
```
Data lives in Docker volumes (`fhir-db`, `dashboard-data`) and is kept across updates.

## Logs and backups

```bash
docker compose logs -f dashboard   # AHIP Manage
docker compose logs -f fhir        # FHIR server
docker compose exec postgres pg_dump -U hapi hapi | gzip > ~/fhir-$(date +%F).sql.gz
docker run --rm -v ahip-collect-server_dashboard-data:/d -v ~/:/b alpine tar czf /b/dashboard-$(date +%F).tgz -C /d .
```
Copy the backups off the server (for example once a day with `cron`).

## Before phones sync over the internet

The FHIR server is deliberately **not** published: in the office the phones write to it directly
with no password, which is only safe inside the office Wi-Fi. Opening it on the internet would
let anyone read or change all collected data. Before phones use this online server:

1. AHIP Manage must forward phone uploads to FHIR only for signed-in, active collectors on their
   registered phone (a protected `/fhir` route).
2. The app must be rebuilt with `FHIR_BASE_URL=https://<your domain>/fhir/` and AHIP Manage reached
   on the same HTTPS address (`MANAGE_PORT` in `AhipAccounts.kt`).

Until then this online server is for the admin dashboard, forms design and AI; collectors keep
syncing to the office server.

## Never commit

`.env` or any backup file. They hold passwords, the Gemini key and
personal data.
