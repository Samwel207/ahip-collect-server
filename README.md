# AHIP backend (AHIP Manage)

The server side of AHIP data collection: AHIP Manage (admin dashboard, user accounts, Google-Forms-style
forms designer with timed quizzes, AI assistant, collector API keys) plus the files to host it with a
HAPI FHIR server.

| Path | Role |
| --- | --- |
| `server.js` | Web server: sign-in, users, phone endpoints, API keys, AI, read-only FHIR proxy |
| `lib/` | Forms designer backend, Excel (XLSForm) import/export, AI, API keys |
| `public/` | Admin web pages (data, users, settings, forms designer, FHIR browser) |
| `tools/create-admin.js` | Creates the first administrator (run on the server only) |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example` | Hosting with Docker and HTTPS |

Plain Node.js 20, no npm packages. To host it online, follow [DEPLOY.md](DEPLOY.md).
