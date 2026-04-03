# URL Shortener & QR Code Generator

A fullstack operator console built with React, Node.js, Tailwind CSS, and Neon PostgreSQL. It supports Short.io and a self-hosted internal short-link system, account-based access, analytics, audit logs, and advanced QR customization.

## Features

- **Authentication**: Register/login flow with persistent operator sessions. The first registered account becomes `admin`.
- **Dual Provider Shortening**: Choose Short.io or the internal Neon-backed shortener, with automatic fallback if the preferred provider fails.
- **Link Operations**: Search, filter, edit title, update internal custom slug, set expiry, activate/deactivate, and delete links.
- **Analytics**: Per-link click counts, 7-day click activity, and top-link ranking.
- **Admin Audit View**: Admins can inspect recent operator actions across the workspace.
- **Advanced QR Generator**:
  - Custom foreground and background colors
  - Gradient support
  - Multiple QR styles and corner variants
  - Optional logo upload
  - Real-time QR preview and PNG/SVG export

---

## Setup Instructions

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16+)
- A [Short.io](https://short.io/) account and API Key.
- A [Neon](https://neon.tech/) PostgreSQL database connection string.
- A long random `APP_SECRET` value for session and redirect security.
- Optional: a public base URL for internal short links.

### 2. Backend Setup
1. Navigate to the `server` directory:
   ```bash
   cd server
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file (or edit the existing one):
   ```env
   SHORT_IO_API_KEY=your_api_key_here
   SHORT_IO_DOMAIN=your_short_domain_here (e.g., link.yourdomain.com)
   DATABASE_URL=postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/dbname?sslmode=require
   APP_BASE_URL=http://localhost:5000
   APP_SECRET=replace_with_a_long_random_secret
   PORT=5000
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

### 3. Frontend Setup
1. Navigate to the `client` directory:
   ```bash
   cd client
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

### 4. Usage
- Open your browser to `http://localhost:5173`.
- Register the first operator account. That account becomes admin automatically.
- Login and create links from the dashboard.
- Choose **Short.io** or **My system** before submitting.
- Manage existing links from the dashboard with filters, inline edits, and status controls.
- Review click analytics and admin audit activity.

---

## Technology Stack
- **Frontend**: React, Vite, Tailwind CSS, Lucide React, Axios.
- **Backend**: Node.js, Express, Axios, Cors, Dotenv, PostgreSQL.
- **QR Engine**: `qr-code-styling`.
- **Database**: Neon PostgreSQL.

---

## Current Scope

- Session-based authentication backed by Neon
- Internal redirect resolution via `GET /:code`
- Provider fallback between Short.io and the internal shortener
- Link analytics and admin audit visibility
