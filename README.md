# Syntax Verse Hosting — API (backend)

Node.js REST API for the hosting panel. Deploy this repo on **Hostinger Node.js** (or any Node 20+ host).

## Hostinger deploy (Git)

1. **hPanel** → Websites → your site → **Advanced** → **Git** (or Node.js deployment).
2. Connect repository: `https://github.com/sohitgithub/hosting.git`
3. Branch: `main`
4. **Build / install:** `npm ci --omit=dev` (or `npm install --production`)
5. **Start command:** `npm start` (runs `node server.js`)
6. **Application root:** repository root (this folder is the whole repo)
7. **Startup file:** `server.js`

## Environment variables (hPanel → Environment)

Copy from `.env.example` and set in Hostinger (do not commit `.env`):

| Variable | Example |
|----------|---------|
| `NODE_ENV` | `production` |
| `PORT` | (often set by Hostinger automatically) |
| `CLIENT_URL` | `https://your-frontend-domain.com` |
| `PUBLIC_APP_URL` | same as frontend URL |
| `MYSQL_HOST` | Hostinger MySQL hostname |
| `MYSQL_DATABASE` | database name |
| `MYSQL_USER` | database user |
| `MYSQL_PASSWORD` | database password |
| `JWT_SECRET` | long random string |
| `SERVER_PUBLIC_IP` | your Hostinger server IP |
| `SMTP_*` | for password reset emails |

Use Hostinger **MySQL** database (create in hPanel → Databases). Set `MYSQL_AUTO_PROVISION=false` if you create DB manually.

## After deploy

```bash
curl https://api.yourdomain.com/api/health
```

Should return `{"status":"ok",...}`.

## Local dev

```bash
cp .env.example .env
npm install
npm run dev
```

API: `http://localhost:5000`

## Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Production server |
| `npm run db:setup` | Create DB (if auto-provision off) |
| `npm run db:fix-packet` | Fix large upload / packet errors |
