

````markdown
# Consent Manager

A small, end-to-end web app for running consent-driven studies with two roles:

- **Participants**: enroll, set per-category consent, download receipts (PDF), view history & diffs.
- **Researchers**: create/edit studies, invite via join codes, clone templates, search, view participants, export to Excel, delete studies.

This repository contains everything needed to run the app locally.

---

## Stack

- **Node.js** + **Express** + **EJS**
- **PostgreSQL** with **Prisma**
- **express-session** with **connect-pg-simple**
- **express-rate-limit**
- **Puppeteer** for PDF receipts
- Front-end: Tailwind-lite utility classes in EJS

---

## Quickstart

### 0) Requirements
- Node.js 20+ (or 22+)
- PostgreSQL 13+ (local or Docker)
- Linux/macOS/WSL recommended (Puppeteer needs system libs)

### 1) Clone

```bash
git clone https://github.com/nil0711/consent-manager.git
cd consent-manager
````

### 2) Install deps

```bash
npm ci
```

### 3) Configure environment

Copy the example and edit:

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your Postgres connection string.

### 4) Create database & schema

If you have migrations:

```bash
npx prisma migrate deploy
```

If you’re starting fresh or iterating:

```bash
npx prisma db push
```

Generate the Prisma client:

```bash
npx prisma generate
```

*(Optional)* If a seed script exists:

```bash
npx prisma db seed
```

### 5) Start the app

Dev (with auto-reload if `nodemon` is configured):

```bash
npm run dev
```

Prod:

```bash
npm run build   # if you have a build step
npm start
```

Visit **[http://localhost:3000](http://localhost:3000)**

---

## Default routes (high level)

* `GET /` → role-aware landing (login/signup links)
* **Auth**: `/signup`, `/login`, `/logout`
* **Participant**:

  * `/participant` – dashboard (search, join by code, trending, enrollments)
  * Study view: `/s/:slug`
  * Consent actions: `/s/:slug/consent`, `/s/:slug/withdraw`
  * Receipts: `/s/:slug/receipt/latest`, `/s/:slug/receipt/:version`
  * History & diff: `/s/:slug/history`, `/s/:slug/history/diff?v1=&v2=`
* **Researcher**:

  * `/researcher` – your studies (search, clone, delete, export)
  * Create: `/researcher/studies/new`
  * Edit: `/researcher/studies/:slug/edit`
  * Participants table: `/researcher/studies/:slug/participants`
  * Participant detail: `/researcher/studies/:slug/participants/:participantId`
  * Excel exports:

    * `/researcher/studies/:slug/export.xlsx` (full)
    * `/researcher/studies/:slug/participants.csv` (single-sheet Excel)

---

## Environment variables

See `.env.example`. Key ones:

* `DATABASE_URL=postgresql://user:pass@localhost:5432/consentdb?schema=public`
* `SESSION_SECRET=change-me`
* `COOKIE_SECURE=0` (set `1` behind HTTPS)
* `TRUST_PROXY=0` (set `1` behind a reverse proxy)
* Rate limiting:

  * `RATE_LIMIT_WINDOW_MS=600000`
  * `RATE_LIMIT_MAX=600`
  * `RATE_LIMIT_AUTH_MAX=20`
* `MAX_UPLOAD_MB=10`

**Puppeteer**: If your distro requires it, install system libs or set `PUPPETEER_SKIP_DOWNLOAD` if you provide Chromium separately.

---

## Database

Prisma schema lives in `prisma/schema.prisma`. To inspect & tweak:

```bash
npx prisma studio
```

---

