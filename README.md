# Sable — Full-Stack AI Finance-Ops SaaS (Demo)

A **real, functional full-stack web application** — not a static page. Built as a live test of the `ultimate-web-dev` skill (Agency mode, Enterprise tier). Zero external dependencies: runs on Node's built-in modules only.

## What actually works
- **Authentication** — signup + login, passwords hashed with scrypt, sessions via signed JWT (HS256).
- **Database** — SQLite (`node:sqlite`) with a real schema: companies, users, transactions, audit_log.
- **Multi-tenancy** — every query is scoped to the logged-in user's `company_id`; you cannot read another tenant's data (IDOR-safe).
- **Business logic** — a real anomaly-detection engine flags duplicate payments, statistical outliers (>3× median), and large round-number payments to new vendors.
- **Live dashboard** — KPIs (close %, anomalies, volume, cleared) computed from the DB; add / approve / flag / delete transactions with instant re-render.
- **Audit log** — every action recorded and shown.
- **REST API** — documented below.
- **Security** — parameterized SQL, scrypt hashing, constant-time comparisons, auth middleware, input validation, path-traversal guard, security headers, basic rate limiting, no secrets in client code.

## Run it
```bash
cd "dummy 22000"
npm start          # or: node server/server.js
```
Then open **http://localhost:3000**. Demo login: **demo@sable.io / demo1234** (or create a new account — it spins up a fresh tenant).

> Requires Node ≥ 22.5 (uses the built-in `node:sqlite`). No `npm install` needed.

## Structure
```
dummy 22000/
├── server/
│   ├── server.js     # HTTP server, router, API, static serving, security
│   ├── db.js         # SQLite schema + tenant-scoped queries + seed
│   ├── auth.js       # scrypt hashing + JWT (HS256), constant-time compares
│   └── anomaly.js    # anomaly-detection engine (pure, testable)
├── public/
│   ├── index.html    # marketing landing
│   ├── login.html    # auth (login + signup)
│   ├── app.html      # protected dashboard
│   └── assets/       # css (marketing + app) + js (main, auth, app)
├── data/             # sqlite db (gitignored)
├── package.json
└── README.md
```

## API
| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | – | Create account + tenant |
| POST | `/api/auth/login` | – | Get JWT |
| GET | `/api/me` | ✓ | Current user |
| GET | `/api/dashboard/summary` | ✓ | Computed KPIs |
| GET | `/api/transactions` | ✓ | List (tenant-scoped) |
| POST | `/api/transactions` | ✓ | Create → runs anomaly detection |
| PATCH | `/api/transactions/:id` | ✓ | Update status (approve/flag) |
| DELETE | `/api/transactions/:id` | ✓ | Delete |
| GET | `/api/audit` | ✓ | Activity log |

## Anomaly rules (server/anomaly.js)
1. **Duplicate** — same vendor + amount within 7 days.
2. **Statistical outlier** — > 3× the median transaction (with a $10k floor).
3. **Round-number risk** — large round payment (≥ $50k, divisible by 1000) to a new vendor.

## What this demonstrates vs. a static page
A $22k build is *functional software*: real auth, a database, business logic, multi-tenancy, and security — all of which run here. The marketing page (`/`) is just the front door; the product (`/app`) is the actual application.

## Production next steps (not in this demo)
- Move `SABLE_SECRET` to env + real secrets manager; add refresh tokens.
- Postgres (Prisma/Drizzle) instead of SQLite for real scale; migrations.
- Payments (Stripe), email, and real ERP/bank integrations.
- Rate limiting via a store (Redis), CSRF for cookie auth, full test suite, CI/CD, deploy on Vercel/Fly with security headers + WAF.

---
*Built with the `ultimate-web-dev` skill — Agency mode, exercising Phases 3 (backend), 4 (security) and 5 (QA), which the first pass skipped.*
