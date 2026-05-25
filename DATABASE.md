# MySQL setup — Syntax Verse Hosting

## Credentials (default local development)

| Setting | Value |
|---------|--------|
| **Database** | `syntaxverse` |
| **App user** | `syntaxverse` |
| **App password** | `syntaxverse_dev` |
| **Host** | `localhost` |
| **Port** | `3306` |
| **Root user** | `root` (for setup only) |

Copy `backend/.env.example` → `backend/.env` and adjust if needed.

## Quick setup (recommended)

```bash
# 1. Start MySQL
#    Docker:
docker compose up -d mysql

#    Mac (Homebrew):
brew services start mysql

# 2. Create database + user + grants
cd backend
cp .env.example .env    # if you don't have .env yet
npm run db:setup

# 3. Verify
npm run db:verify

# 4. Start API
npm run dev
```

`npm run db:setup` creates:

- Database `syntaxverse` (utf8mb4)
- User `syntaxverse` with password from `MYSQL_PASSWORD`
- Full privileges on that database

On each API start, `MYSQL_AUTO_PROVISION=true` ensures the database exists (safe to leave on in dev).

## Option A — Local MySQL (no Docker)

1. Install MySQL 8: [https://dev.mysql.com/downloads/mysql/](https://dev.mysql.com/downloads/mysql/)
2. In `backend/.env`:

```env
MYSQL_USER=syntaxverse
MYSQL_PASSWORD=syntaxverse_dev
MYSQL_DATABASE=syntaxverse
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASSWORD=          # your Mac root password, or empty
```

3. Run `npm run db:setup`

## Option B — Docker MySQL

1. From project root:

```bash
cp .env.docker.example .env
docker compose up -d mysql
```

2. In `backend/.env` use the **Docker app user** (not root):

```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=syntaxverse
MYSQL_USER=svh
MYSQL_PASSWORD=svhpass
MYSQL_ROOT_USER=root
MYSQL_ROOT_PASSWORD=rootpass
```

3. Run `npm run db:setup` (grants `svh` access; DB already exists from compose)

4. API in Docker uses `MYSQL_HOST=mysql` automatically via `docker-compose.yml`.

## Troubleshooting

| Error | Fix |
|-------|-----|
| `ECONNREFUSED` | Start MySQL (`brew services start mysql` or `docker compose up -d mysql`) |
| `Access denied` for `syntaxverse` | `cd backend && npm run db:setup` |
| `Access denied` for `root` | Set correct `MYSQL_ROOT_PASSWORD` in `.env` |
| Port 3306 in use | Stop other MySQL or change `MYSQL_PORT` |

## phpMyAdmin (Hostinger-style)

**ERR_CONNECTION_REFUSED on :8080** means the database manager is not started.

### Local dev (no Docker — real phpMyAdmin UI)

1. PHP required: `brew install php` (if `php -v` fails).
2. From project root (first run downloads phpMyAdmin ~12 MB):

```bash
npm run pma:up
```

3. Keep the API running: `cd backend && npm run dev` (port 5000).

4. In `backend/.env`:

```env
PHPMYADMIN_URL=http://localhost:8080
PHPMYADMIN_MODE=phpmyadmin
PHPMYADMIN_MYSQL_HOST=127.0.0.1
```

Open **http://localhost:8080** or **Dashboard → Databases → Go to phpMyAdmin** (Hostinger-style phpMyAdmin UI).

Stop: `npm run pma:down`

### Optional: Docker phpMyAdmin

Install Docker Desktop, set `PHPMYADMIN_MODE=docker`, `PHPMYADMIN_MYSQL_HOST=host.docker.internal`, then `npm run pma:up` (uses Docker if PHP is missing).

## Manual SQL (optional)

```sql
CREATE DATABASE IF NOT EXISTS syntaxverse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'syntaxverse'@'localhost' IDENTIFIED BY 'syntaxverse_dev';
CREATE USER IF NOT EXISTS 'syntaxverse'@'%' IDENTIFIED BY 'syntaxverse_dev';
GRANT ALL PRIVILEGES ON syntaxverse.* TO 'syntaxverse'@'localhost';
GRANT ALL PRIVILEGES ON syntaxverse.* TO 'syntaxverse'@'%';
FLUSH PRIVILEGES;
```
