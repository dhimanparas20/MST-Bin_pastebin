# MST Bin - Modern Pastebin Clone

MST Bin is a modern, feature-rich pastebin clone that allows users to share text snippets with automatic expiration. Built with Flask and MongoDB, it features a sleek dark theme interface with syntax highlighting, line numbers, keyboard shortcuts, and a full admin dashboard.

## Screenshots

### Homepage
![Homepage](static/img/ss1.png)
*Homepage with dark violet gradient, CodeMirror syntax-highlighted editor, and sidebar controls*

### Paste View
![Paste View](static/img/ss2.png)
*Individual paste view with highlight.js syntax coloring*

## Features

### Editor & Paste
- Dark violet gradient theme with animated glassmorphism background
- **Live syntax highlighting** in the editor (CodeMirror 5 + monokai theme)
- **Auto language detection** — paste code and language is automatically identified
- **Custom paste keys** — choose your own memorable key (4-20 chars, optional, checked for uniqueness)
- **Password-protected pastes** — lock pastes with a password, viewer must enter password via glassmorphism modal
- **Auto-delete** — set expiry in seconds to months, lazy deletion on access
- **View-once pastes** — paste auto-deletes after first view, "VIEW ONCE" warning shown
- **Delete after N views** — set a max view count, paste auto-deletes after N views
- **Load paste by ID** — quickly open any paste by entering its key on any page
- **Language selector** — 25+ languages (Python, JS, Go, Rust, SQL, YAML, Dockerfile, etc.)
- **Responsive hamburger sidebar** — all settings in a right-side panel, auto-open on desktop, drawer on mobile
- One-click copy button on paste view
- **Size limit** — configurable max paste size (default 10,000 chars)

### Admin Dashboard (`/admin`)
- **Analytics panel** — total pastes, views, avg views, pastes per day/week/month, language distribution chart, encryption distribution chart
- **Full paste table** — key, title, language, date, IP, views, encryption status, expiry status
- **Search** — by key, heading, or IP address
- **Filters** — by language, encryption type (server/password/none)
- **Sorting** — by date, views, key, title, language (asc/desc)
- **Server-side pagination** — 10/20/50/100 per page
- **Paste detail modal** — view full paste content, metadata, decryption for server-encrypted pastes
- **Delete individual pastes** — with confirmation modal
- **Delete expired pastes** — one-click cleanup of expired, viewed-once, and max-views-exceeded pastes
- **Session-based auth** — credentials from `.env`, 8-hour session timeout, secure cookie flags

### Security
- **SECRET_KEY validation** — fails on startup if missing/default in production
- **Session security** — HttpOnly, SameSite=Lax, Secure (in prod), 8-hour timeout
- **Admin password** — constant-time comparison via `hmac.compare_digest`
- **Security headers** — X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS (prod)
- **MongoDB indexes** — unique index on `key`, indexes on `created_at`, `open_count`
- **Input validation** — heading length limit (200 chars), language whitelist, regex-escaped search, pagination bounds
- **Rate limiting protection** — admin login failure logging, key generation max retries
- **Health check** — `GET /health` endpoint for monitoring
- **AES-256 encryption** — server-side encryption at rest, password-protected pastes use user password as key
- **Gzip compression** — on all HTML/JSON responses > 500 bytes
- **Structured logging** — Python logging module with timestamps and levels

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask + Flask-RESTful |
| Database | MongoDB (PyMongo) with indexes |
| Editor | CodeMirror 5 (CDN) |
| Viewer highlighting | highlight.js 11 (CDN) |
| Styling | TailwindCSS 2.2 + custom CSS (main), Bootstrap 5.3 (admin) |
| Charts | Chart.js 4.4 (admin dashboard) |
| Compression | Python gzip (stdlib) |
| Scheduling | APScheduler |
| Deployment | Docker + Docker Compose |

## Prerequisites

- Python 3.8+
- MongoDB
- Docker (optional)

## Environment Variables

Create a `.env` file in the root directory (see `env_sample`):

```env
MONGO_CONNECTION_STRING=mongodb://localhost:27017
MONGO_DB_NAME=pastebin
MONGO_COLLECTION_NAME=pastes
KEY_LENGTH=6
MAX_PASTE_SIZE=10000
FLASK_DEBUG=False
FLASK_PORT=5000
FLASK_HOST=0.0.0.0
SECRET_KEY=your_strong_random_secret_key
ENCRYPTION_KEY=change-me-to-a-random-string
FLASK_ENV=dev
STATIC_BASE_URL=/
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-to-a-strong-password
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_CONNECTION_STRING` | — | MongoDB connection URI (**required**) |
| `MONGO_DB_NAME` | `pastebin` | Database name |
| `MONGO_COLLECTION_NAME` | `pastes` | Collection name |
| `KEY_LENGTH` | `6` | Length of generated paste keys |
| `MAX_PASTE_SIZE` | `10000` | Maximum characters per paste |
| `FLASK_DEBUG` | `False` | Enable Flask debug mode (blocked in prod) |
| `FLASK_PORT` | `5000` | Server port |
| `FLASK_HOST` | `0.0.0.0` | Server bind address |
| `SECRET_KEY` | — | Flask session secret (**required in prod**) |
| `ENCRYPTION_KEY` | — | AES-256 server-side encryption key |
| `FLASK_ENV` | `dev` | `dev` or `prod` |
| `STATIC_BASE_URL` | `/` | S3 bucket URL in production |
| `ADMIN_USERNAME` | `admin` | Admin panel username |
| `ADMIN_PASSWORD` | `admin` | Admin panel password (**change in prod**) |

## Quick Start

```bash
# Clone and enter the repo
git clone <repo-url> && cd MST-Bin_pastebin

# Set up environment
cp env_sample .env
# Edit .env with your MongoDB connection string and secret keys

# Install dependencies
uv sync

# Run
uv run python app.py
```

## Deployment

```bash
docker compose up -d
```

Exposes on port 80 → internal 5000 via Gunicorn (4 workers).

## API

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Editor homepage |
| `POST` | `/api/save` | Save a paste. Body: `{data, heading, language, custom_key?, password?, expiry_value?, expiry_unit?, view_once?, max_views?}` |
| `GET` | `/<key>` | View a paste. If locked shows password modal. If expired/viewed-once shows 404 |
| `POST` | `/api/access/<key>` | Unlock a protected paste `{password}`. Returns paste data or 403 |
| `GET` | `/health` | Health check (returns MongoDB ping status) |

### Admin Endpoints (session-authenticated)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET/POST` | `/admin/login` | Admin login page |
| `POST` | `/admin/logout` | Logout (POST only) |
| `GET` | `/admin` | Admin dashboard |
| `GET` | `/api/admin/pastes` | List pastes (paginated, searchable, filterable) |
| `GET` | `/api/admin/paste/<key>` | Paste detail (decrypts server-encrypted pastes) |
| `DELETE` | `/api/admin/paste/<key>` | Delete a paste |
| `DELETE` | `/api/admin/delete-expired` | Delete all expired/view-once/max-views pastes |
| `GET` | `/api/admin/analytics` | Dashboard analytics data |
