# MST Bin - Modern Pastebin Clone

MST Bin is a modern, feature-rich pastebin clone that allows users to share text snippets with automatic expiration. Built with Flask and MongoDB, it features a sleek dark theme interface with syntax highlighting, line numbers, keyboard shortcuts, and a full admin dashboard.

## Screenshots

### Homepage
![Homepage](public/img/ss1.png)
*Homepage with dark violet gradient, CodeMirror syntax-highlighted editor, and sidebar controls*

### Paste View
![Paste View](public/img/ss2.png)
*Individual paste view with highlight.js syntax coloring*

## Features

### Editor & Paste
- Dark violet gradient theme with animated glassmorphism background
- **Live syntax highlighting** — colors update while typing or pasting, before saving (CodeMirror 5 + monokai theme)
- **Continuous auto language detection** — Auto Detect stays selected as content changes; the detected language appears separately below the selector
- **Editor assistance** — live language-aware indentation, matching/auto-closing brackets, HTML/XML tag closing, and autocomplete (Ctrl+Space; suggestions vary by language)
- **Word wrap** — enabled by default; toggle it in the editor sidebar
- **Custom paste keys** — choose your own memorable key (4-40 chars, optional; spaces auto-converted to `-`)
- **ID prefixes** — optional prefix (1-15 chars: letters, digits, `-`) gives IDs like `premagic_Ab12Cd`; combined with a custom key it becomes `premagic_my-key`. The sidebar previews the resulting ID
- **Prefix search** — search icon in the navbar (editor and viewer) lists live pastes whose ID starts with `<prefix>_` (case-insensitive, newest 50): ID, title, description, language, created date, views, expiry and lock/view-once/encryption badges. Click a result to open it. Paste content is never returned, and searching does not count a view
- **Title & description** — title up to 40 chars; optional multi-line description up to 100 chars (textarea below language)
- **Password-protected pastes** — lock pastes with a password, viewer must enter password via glassmorphism modal
- **Auto-delete** — set expiry in seconds to months, lazy deletion on access
- **View-once pastes** — paste auto-deletes after first view, "VIEW ONCE" warning shown; the creator's redirect after saving is not counted as a view
- **Delete after N views** — set a max view count, paste auto-deletes after N views
- **Load paste by ID** — paste ID + Go in the top navbar on editor and viewer pages (`/` focuses the input)
- **New paste button** — the `+` icon in the navbar opens a new editor in a new tab (Ctrl+N still opens it in the same tab)
- **Language selector** — 25+ languages (Python, JS, Go, Rust, SQL, YAML, Dockerfile, etc.)
- **Responsive hamburger sidebar** — all settings in a right-side panel, auto-open on desktop, drawer on mobile
- **Paste info flyout** — on paste view, toggleable right panel with title, description, ID, language, views, expiry, lock/view-once badges
- **Centered title** — paste header: logo + language + key on the left, title centered, controls on the right
- **Keyboard shortcuts** — Ctrl+S save, Ctrl+N new paste, Ctrl+Shift+K delete line (editor), Ctrl+/ toggle comment (editor), Ctrl+Shift+/ About (editor), Ctrl+/ About (viewer), Esc close, `/` focus paste ID, Ctrl+Shift+C copy, Ctrl+I paste info (listed in About card)
- One-click copy button on paste view
- **Size limit** — configurable max paste size (default 10,000 chars)

### Using the Editor

- **Syntax colors:** leave the language selector on **Auto Detect**, or choose a language explicitly. Highlighting happens directly in the editor before saving. Detection runs after a 600 ms pause, examines the first 5,000 characters, and uses plain text when no confident supported match is found.
- **Word wrap:** the checkbox below the language selector starts checked on each new editor page. Uncheck it for horizontal scrolling. Wrapping is display-only: it does not insert newlines or change the saved content, and the setting is not persisted between pages.
- **Suggestions:** supported code modes show suggestions while typing. Press **Ctrl+Space** to request them manually, use the arrow keys to navigate, **Enter/Tab** to accept, and **Esc** to dismiss. Automatic suggestions skip comments and plain-text mode.
- **Completion coverage:** JavaScript, CSS, SQL, and HTML have dedicated hint addons; XML hints depend on available schema information. Other modes can offer registered keyword hints or words already in the paste. These are browser-side completions, not AI suggestions or project-aware language-server analysis.
- **Indentation and pairing:** Enter uses the current mode's smart indentation with a four-space indent setting. Code modes match and auto-close brackets; HTML/XML also close tags. Support varies by language mode.
- **Line shortcuts:** with focus in the editor, **Ctrl+Shift+K** deletes the current line (or selected lines), and **Ctrl+/** toggles comments on the current or selected lines using the effective language mode's comment syntax. Plain text and modes without comment syntax are left unchanged. Left and right Ctrl keys both work; Command equivalents are available on macOS. **Ctrl+Shift+/** opens About in the editor; the viewer retains **Ctrl+/** for About.
- **Language downloads:** less-common modes load on demand. A failed download shows feedback below the selector; switch away and select that language again to retry. Late downloads cannot overwrite a newer language selection.

### Admin Dashboard (`/admin`)
- **Analytics panel** — total pastes, views, avg views, pastes per day/week/month, language distribution chart, encryption distribution chart
- **Full paste table** — key, title, language, date, IP, views, encryption status, expiry status
- **Search** — by key, heading, or IP address
- **Filters** — by language, encryption type (server/password/none)
- **Sorting** — by date, views, key, title, language (asc/desc)
- **Server-side pagination** — 10/20/50/100 per page
- **Paste detail modal** — view full paste content, metadata (including description), decryption for server-encrypted pastes
- **Delete individual pastes** — with confirmation modal
- **Multi-select batch delete** — checkboxes + select-all (current page); selection persists across pages; delete up to 100 at once
- **Delete expired pastes** — one-click cleanup of expired, viewed-once, and max-views-exceeded pastes
- **Session-based auth** — credentials from `.env`, 8-hour session timeout, secure cookie flags

### Security
- **SECRET_KEY validation** — fails on startup if missing/default in production
- **Session security** — HttpOnly, SameSite=Lax, Secure (in prod), 8-hour timeout
- **Admin password** — constant-time comparison via `hmac.compare_digest`
- **Security headers** — X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS (prod)
- **MongoDB indexes** — unique index on `key`, indexes on `created_at`, `open_count`
- **Input validation** — heading max 40 chars, description max 100 chars, custom key 4-40, prefix 1-15 (no `_`), language whitelist, regex-escaped search, pagination bounds
- **Abuse logging** — failed admin logins are logged with the client IP (no login rate limiting yet); key generation gives up after 10 collisions
- **Health check** — `GET /health` endpoint for monitoring
- **Encryption at rest** — Fernet (AES-128-CBC + HMAC-SHA256, key derived from SHA-256 of the secret); server key from `ENCRYPTION_KEY`, password-protected pastes use the user password as key
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

- Python 3.14+ (see `.python-version`)
- [uv](https://docs.astral.sh/uv/)
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
USE_CDN_STATIC=false
STATIC_BASE_URL=https://<S3_BUCKET_NAME>.s3.ap-south-1.amazonaws.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change-me-to-a-strong-password
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_CONNECTION_STRING` | `mongodb://localhost:27017` | MongoDB connection URI (startup fails if set to an empty string) |
| `MONGO_DB_NAME` | `pastebin` | Database name |
| `MONGO_COLLECTION_NAME` | `pastes` | Collection name |
| `KEY_LENGTH` | `6` | Length of generated paste keys |
| `MAX_PASTE_SIZE` | `10000` | Maximum characters per paste |
| `FLASK_DEBUG` | `False` | Enable Flask debug mode (blocked in prod) |
| `FLASK_PORT` | `5000` | Server port |
| `FLASK_HOST` | `0.0.0.0` | Server bind address |
| `SECRET_KEY` | — | Flask session secret (**required in prod**) |
| `ENCRYPTION_KEY` | — | Server-side encryption secret (pastes stored in plaintext when unset) |
| `FLASK_ENV` | `dev` | `dev` or `prod` (SECRET_KEY, secure cookies, HSTS) |
| `USE_CDN_STATIC` | `false` | `true` = load CSS/JS/img from `STATIC_BASE_URL` |
| `STATIC_BASE_URL` | _(empty)_ | S3/CDN origin (only used when `USE_CDN_STATIC=true`) |
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

Exposes port 5000 (host) → 5000 (container) via Gunicorn (4 workers, `GUNICORN_WORKERS`). The compose file sets `GUNICORN_RELOAD=true`; the image default is `false`. The container healthcheck calls `GET /health`, so it reports unhealthy when MongoDB is unreachable.

The weekly cleanup job runs in every Gunicorn worker, but only one worker per cycle does the work: workers claim the run through a document in the `scheduler_locks` collection.

### Vercel

- `vercel.json` routes app traffic to `app.py`; `public/css|js|img` are published via `@vercel/static`
- Set `USE_CDN_STATIC=false` to serve assets from Vercel CDN (`/css`, `/js`, `/img`)
- Set `USE_CDN_STATIC=true` + `STATIC_BASE_URL` to load assets from S3 instead

## API

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Editor homepage |
| `POST` | `/api/save` | Save a paste. Body: `{data, heading, language, description?, custom_key?, prefix?, password?, expiry_value?, expiry_unit?, view_once?, max_views?}`. Key is `prefix_custom_key`, `prefix_<random>`, `custom_key` or `<random>` |
| `GET` | `/api/search?prefix=<p>` | Public prefix search. Returns `{prefix, results[], total, limit}`; each result has key, heading, description, language, created_at, expires_at, expires_text, open_count, max_views, view_once, password_protected, encrypted_with. Excludes expired/consumed pastes; never returns content or IP |
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
| `DELETE` | `/api/admin/pastes` | Batch delete. Body: `{keys: ["id1", "id2", ...]}` (max 100, keys up to 56 chars) |
| `DELETE` | `/api/admin/delete-expired` | Delete all expired/view-once/max-views pastes |
| `GET` | `/api/admin/analytics` | Dashboard analytics data |
