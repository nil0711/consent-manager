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
