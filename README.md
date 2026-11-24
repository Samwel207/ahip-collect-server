# AHIP backend (AHIP Manage)

The server side of AHIP data collection: AHIP Manage (admin dashboard, user accounts, Google-Forms-style
forms designer with timed quizzes, AI assistant, collector API keys) plus the files to host it with a
HAPI FHIR server.

| Path | Role |
| --- | --- |
| `server.js` | Web server: sign-in, users, phone endpoints, API keys, AI, read-only FHIR proxy |
| `lib/` | Forms designer backend, Excel (XLSForm) import/export, AI, API keys |
| `public/` | Admin web pages (data, users, settings, forms designer, FHIR browser) |
| `public/collect.*` | AHIP Collect Web: the data collection app in the browser (for iPhones), at `/collect` |
| `tools/create-admin.js` | Creates the first administrator (run on the server only) |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `.env.example` | Hosting with Docker and HTTPS |

## Roles

| Role | AHIP Manage | Data collection |
| --- | --- | --- |
| Administrator | Everything: data, users, phones, settings, forms, FHIR browser | Phone app and AHIP Collect Web |
| Supervisor | Home page (submitted data, charts, AI) and the Forms designer | Phone app and AHIP Collect Web |
| Data collector | No access | Phone app and AHIP Collect Web |

## AHIP Collect Web

Data collectors without an Android phone open `https://<server>/collect` in Safari or Chrome, sign in with
their AHIP account and fill the same forms as the phone app (drafts kept on the phone, sent when online).
On iPhone, "Share > Add to Home Screen" makes it open like an app. Photos work on any address; GPS and
recording directly in the browser need the HTTPS address (browsers allow them only on secure sites).

Plain Node.js 20, no npm packages. To host it online, follow [DEPLOY.md](DEPLOY.md).
