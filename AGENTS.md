# AGENTS.md — Project Guide for AI Assistants

## Project Overview

MST Bin is a pastebin web app: users paste text/code, get a shareable link. Flask backend + MongoDB + vanilla JS frontend with CodeMirror/highlight.js for syntax highlighting. Includes a full admin dashboard with analytics, search, filtering, and paste management.

## Directory Structure

```
.
├── app.py                  # Flask app: routes, API, admin panel, scheduler, gzip middleware, security
├── pyproject.toml          # Project dependencies (uv)
├── uv.lock                 # Locked dependency versions
├── Dockerfile              # Docker image
├── docker-compose.yaml     # Gunicorn 4 workers, port 80→5000
├── env_sample              # Template for .env file
├── vercel.json             # Vercel deployment config
├── README.md               # Human-facing docs
├── AGENTS.md               # This file — AI assistant guide
├── templates/
│   ├── index.html          # Editor page (CodeMirror + language selector + sidebar)
│   ├── paste.html          # Paste view page (highlight.js + line numbers + 404 page)
│   ├── admin.html          # Admin dashboard (Bootstrap + Chart.js + data tables)
│   └── admin_login.html    # Admin login page (Bootstrap)
└── public/
    ├── css/
    │   ├── styles.css      # Main app styles: glassmorphism, CodeMirror overrides, responsive
    │   └── admin.css       # Admin panel styles: dark purple theme, tables, modals
    ├── js/
    │   ├── script.js       # Editor logic: CodeMirror init, language detection, save, sidebar
    │   └── admin.js        # Admin logic: analytics, CRUD, charts, pagination, search/filter
    └── img/
        ├── favicon.ico
        ├── logo.jpeg
        ├── ss1.png
        └── ss2.png
```

## Architecture & Data Flow

```
[Browser: index.html + script.js]
    │  CodeMirror editor, hamburger sidebar (desktop open, mobile hidden)
    │  Sidebar: title, custom key, load paste, language, lock toggle, expiry, view-once, max-views
    │
    ▼ POST /api/save  {data, heading, language, custom_key?, password?, expiry_value?, expiry_unit?, view_once?, max_views?}
[Flask: app.py → SavePaste]
    │  Validates size ≤ MAX_PASTE_SIZE, validates custom_key (4-20 alphanumeric/-/_, no spaces),
    │  checks uniqueness if custom_key provided, else generates random key (unique index + DuplicateKeyError),
    │  hashes password with werkzeug.security if provided (no spaces allowed),
    │  encrypts with Fernet (AES-256) if ENCRYPTION_KEY set or password provided,
    │  calculates expires_at from expiry_value+expiry_unit (sec/min/hr/day/week/month),
    │  sets view_once flag, max_views limit if requested,
    │  created_at = int(time.time())  (Unix epoch), ip_address = validated X-Forwarded-For or remote_addr
    │
    ▼ 302 redirect /<key>
[Browser: paste.html]
    │  GET /<key>
    ▼
[Flask: app.py → GetPaste]
    │  Skips reserved keys: admin, api, health
    │  Checks: expiry passed? → delete + 404 page.  view_once + already viewed? → delete + 404.
    │  max_views reached? → delete + 404.
    │  If paste has password_hash: renders modal (no content)
    │  If no password_hash: increments open_count, decrypts if server-encrypted, renders content
    │  Passes expires_text ("Expires in X days") and view_once flag to template
    ▼
[Browser: paste.html]
    │  If 404: "Paste Not Found" page with animation + "Create New Paste" button
    │  If locked: glassmorphism modal, POST /api/access/<key> {password} to unlock
    │  If unlocked/public: codeBlock.textContent = paste_data (XSS-safe via tojson filter)
    │  hljs.highlightElement(codeBlock)
    │  Custom line numbers synced on scroll
    │  Paste ID nav input in navbar to jump to another paste, '/' shortcut
    │  Displays expiry timer, view-once indicator, lock indicator in navbar

[Admin Panel: admin.html + admin.js]
    │  Bootstrap 5 dashboard, Chart.js analytics
    │
    ▼ GET /admin/login → POST /admin/login (session-based auth)
[Flask: app.py → admin_login]
    │  Validates credentials with hmac.compare_digest (constant-time)
    │  Clears session before setting new login (prevents session fixation)
    │  Sets session.permanent = True (8-hour timeout)
    │  Session cookie: HttpOnly, SameSite=Lax, Secure in prod
    ▼
[Browser: admin.html]
    │  Loads analytics from /api/admin/analytics
    │  Loads paginated paste list from /api/admin/pastes?page=&per_page=&search=&sort_by=&sort_order=&language=&encrypted=
    │  Search: regex-escaped to prevent ReDoS
    │  Filters: language whitelist, encryption type
    │  Sort: created_at, open_count, key, heading, language
    │  Pagination: server-side with MongoDB skip/limit
    │
    │  View paste → /api/admin/paste/<key> (decrypts server-encrypted, shows placeholder for password)
    │  Delete paste → DELETE /api/admin/paste/<key>
    │  Clean expired → DELETE /api/admin/delete-expired (expired by time + viewed-once + max-views exceeded)
    │  Logout → POST /admin/logout (session.clear())
```

## Key Files

### `app.py`

**Imports & Setup**
- `logging` module (not print), `hmac` for constant-time comparison, `secrets` for key generation
- Flask session config: `SESSION_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE='Lax'`, `SESSION_COOKIE_SECURE=True` in prod
- `PERMANENT_SESSION_LIFETIME=timedelta(hours=8)`, `MAX_CONTENT_LENGTH=MAX_PASTE_SIZE*4`
- `ALLOWED_LANGUAGES` set for input validation
- `IP_REGEX` for X-Forwarded-For validation

**Security Features**
- `SECRET_KEY`: validated at startup — raises `RuntimeError` if missing/default in prod, generates random in dev
- `ADMIN_PASSWORD`: compared with `hmac.compare_digest()` (constant-time, no timing attack)
- Session regeneration: `session.clear()` before setting new login values
- Security headers in `@app.after_request`: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, HSTS (prod)
- Error handlers: `PyMongoError` → 503, `413` → paste too large message

**MongoDB**
- `MongoClient` with `maxPoolSize=10`, `minPoolSize=2`, `serverSelectionTimeoutMS=5000`
- Indexes created on startup: `key` (unique), `created_at` (descending), `open_count` (descending), compound `(created_at, open_count)`
- `_ensure_indexes()` called at module load

**Helper Functions**
- `_get_user_ip()` — validates X-Forwarded-For against IP regex, falls back to remote_addr
- `generate_key()` — random alphanumeric key, uses unique index check + DuplicateKeyError, max 10 retries
- `format_expiry(expires_at)` — human-readable "Expires in X days/hours/mins/secs"
- `_derive_fernet_key(secret)` — SHA-256 → base64 for Fernet key derivation
- `_get_fernet(key)` — cached Fernet instances (thread-safe, avoids re-init)
- `_encrypt(plaintext, key)` / `_decrypt(ciphertext, key)` — Fernet AES-256

**Resources**
- `SavePaste` — POST `/api/save`: validates JSON body (get_json silent=True), heading max 200 chars, language whitelist, size check, password validation (no spaces, max 128), custom_key format + uniqueness, encrypts if password or ENCRYPTION_KEY, DuplicateKeyError handling
- `GetPaste` — GET `/<key>`: skips reserved keys (admin/api/health), checks expiry/view_once/max_views (deletes if violated), increments open_count, decrypts server-encrypted, renders paste.html
- `AccessPaste` — POST `/api/access/<key>`: checks expiry/view_once/max_views, validates password with check_password_hash, always increments open_count (consistent with GetPaste), decrypts with user password
- `Index` — GET `/`: renders index.html

**Admin Routes**
- `admin_required` decorator — checks `session['admin_logged_in']`, returns 401 JSON for API routes, redirect for page routes
- `GET/POST /admin/login` — session-based auth with hmac.compare_digest, session.clear() before login, permanent session
- `POST /admin/logout` — session.clear(), POST only (not GET, prevents CSRF logout)
- `GET /admin` — renders admin.html with username
- `GET /api/admin/pastes` — paginated list with search (re.escape), language/encryption filters, sort, server-side skip/limit
- `GET /api/admin/paste/<key>` — full detail with decryption for server-encrypted pastes
- `DELETE /api/admin/paste/<key>` — single paste deletion
- `DELETE /api/admin/delete-expired` — bulk cleanup: expired by time + viewed-once + max-views (uses $expr for field comparison)
- `GET /api/admin/analytics` — total pastes, views, avg views, per-day/week/month counts, password/view-once/encrypted counts, language distribution, encryption distribution
- `GET /health` — MongoDB ping, returns `{status: "healthy/unhealthy"}`

**Scheduler**
- `delete_pastes()` — runs every 7 days: deletes low-view old pastes + expired by time + viewed-once pastes
- `scheduler.start()` called both in `__main__` and at module level (works under Gunicorn)

### `templates/index.html`
- Tailwind 2.2 CDN + CodeMirror 5 CDN + highlight.js 11 CDN
- CodeMirror modes pre-loaded: python, javascript, xml, htmlmixed, css, clike, shell, sql, yaml, markdown, php, ruby
- Modes loaded dynamically: typescript, go, rust, swift, lua, perl, dockerfile, nginx
- **Hamburger sidebar**: `<aside id="sidePanel">` — glassmorphism panel on right side. Desktop auto-open (pushes editor left), mobile closed by default with overlay
- **Sidebar controls**: title input, custom key, load paste + Go, language selector, lock toggle + password + eye icon, auto-delete (value + unit: sec/min/hr/day/week/month), view-once toggle, delete-after-N-views toggle
- **Save button**: in sidebar bottom when open, in top navbar when sidebar closed, shows spinner + disabled during save
- **Hamburger button**: right side of navbar, toggles sidebar open/close
- Editor via `<textarea id="pasteArea">` transformed by `CodeMirror.fromTextArea()`

### `templates/paste.html`
- highlight.js 11 CDN (monokai theme)
- Paste content injected via JS: `codeBlock.textContent = {{ paste | tojson }}` — XSS safe, preserves raw characters
- Language badge in navbar: `<span id="langBadge">{{ language }}</span>`
- Custom line numbers (`#lineNumbers`) synced with pasteContent scroll
- **Password modal**: glassmorphism overlay with blur backdrop, password input with eye toggle, POST to `/api/access/<key>`
- **Paste ID nav**: input + Go button in navbar to navigate to another paste, `/` key shortcut to focus
- **Paste not found**: clean centered page with file icon, "Not Found" heading, paste key display, purple "Create New Paste" button
- **Expiry display**: shows "Expires in X days/hours/mins/secs" in navbar when applicable
- **View-once indicator**: bold `VIEW ONCE` pill badge in navbar + floating warning banner near content
- **Ctrl+A handled**: prevents browser default, selects only `#pasteContent` contents
- Copy button uses `pasteContent.innerText` (raw text, no HTML)

### `templates/admin.html`
- Bootstrap 5.3 CDN + Font Awesome 6.5 + Chart.js 4.4
- **Navbar**: logo, username display, view site link, logout (POST form)
- **Analytics cards**: 8 stat cards (total pastes, total views, last 24h, protected, last week, last month, avg views, view-once)
- **Charts**: language distribution (bar), encryption distribution (doughnut)
- **Filters**: search (key/heading/IP), language dropdown, encryption filter, sort by/order, per-page selector
- **Pastes table**: 10 columns (#, key, title, language, date, IP, views, encrypted, expires, actions)
- **Action buttons**: view details, open paste (new tab), delete (confirmation modal)
- **Paste detail modal**: full metadata + content display + open link + delete button
- **Delete confirmation modal**: shows paste key, warning text, confirm/cancel
- **Clean Expired button**: one-click cleanup with loading state
- **Toast notifications**: success/error feedback
- **Pagination**: server-side with page numbers, prev/next, ellipsis

### `templates/admin_login.html`
- Bootstrap 5.3 CDN + Font Awesome 6.5
- Glassmorphism card with logo, username/password inputs, password visibility toggle
- Error alert display
- Back to MST Bin link

### `public/js/script.js`
- **`MODE_MAP`**: internal language name → CodeMirror MIME type
- **`DYNAMIC_MODES`**: languages that load mode scripts lazily
- **`HLJS_ALIAS_MAP`**: maps highlight.js language names to internal names (e.g., `"c++"→"cpp"`)
- **`MODE_PARENT_MAP`**: maps MIME-derived names to parent modes (e.g., `"csrc"→"clike"`)
- **`detectLanguage(code)`**: uses `hljs.highlightAuto()`, relevance ≥ 3 threshold, validates against MODE_MAP
- **`setEditorMode(language)`**: checks `CodeMirror.modes` for loaded modes (using parent map), loads dynamically if needed
- **Auto-detect trigger**: on `editor.on("change")` when `currentLanguage === "auto"` (debounced 600ms)
- **Save**: resolves "auto" language to detected before POSTing, includes optional `custom_key` if provided, shows spinner + disables buttons during save, re-enables on error
- **Load paste**: reads key from `#loadPasteKey`, navigates to `/<key>`
- **Lock toggle**: shows/hides `#passwordSection`, swaps lock SVG icons, sends password in POST body
- **Expiry toggle**: shows/hides `#expirySection` (value + unit), sends expiry_value/expiry_unit in POST body
- **View-once toggle**: toggles `view_once` boolean, sends in POST body
- **Ctrl+V anywhere**: focuses editor and pastes clipboard content when no input/textarea/select is active
- **Eye icon toggle**: switches password input type between `password` and `text`
- **Space validation**: client-side checks that custom key, paste ID, password contain no spaces
- **Sidebar responsive**: auto-opens on desktop (>=640px), closed on mobile, overlay backdrop on mobile
- **`viewportMargin: 100`** (not Infinity) for performance with large pastes

### `public/js/admin.js`
- **Pagination state**: `currentPage`, `currentSortBy`, `currentSortOrder`, `currentSearch`, `currentLanguage`, `currentEncryption`, `perPage`
- **`loadAnalytics()`**: fetches `/api/admin/analytics`, updates 8 stat cards, updates charts
- **`loadPastes()`**: fetches `/api/admin/pastes` with all filter/sort/page params, shows loading spinner, handles empty state ("No pastes found"), error state
- **`renderPastesTable(pastes)`**: builds table HTML with `escapeHtml()` on all user data, encryption/expiry badges, action buttons
- **`renderPagination(page, totalPages, total)`**: page numbers with ellipsis, prev/next, handles empty results
- **`viewPaste(key)`**: fetches detail from `/api/admin/paste/<key>`, shows Bootstrap modal with full metadata + decrypted content
- **`showDeleteModal(key)`**: shows confirmation modal
- **`deletePaste(key)`**: DELETE with loading spinner on confirm button
- **`deleteExpired()`**: DELETE `/api/admin/delete-expired` with loading spinner on button
- **Charts**: Chart.js bar (languages) + doughnut (encryption)
- **`escapeHtml(text)`**: DOM-based HTML entity escaping
- **`getEncryptionBadge()`/`getExpiryBadge()`: returns styled badge HTML
- **`showToast(title, message, type)`**: Bootstrap toast notifications

### `public/css/styles.css`
- **Dark violet gradient body**: `#08000f` base with 3 radial purple glows + `bgPulse` animation (12s alternate)
- CodeMirror overrides: dark purple `#07000d` background, `#0a0014` gutters, monospace font
- CodeMirror selection: blue tint when focused, white tint otherwise
- highlight.js overrides: dark purple `#07000d` background, monokai color palette
- Modal glassmorphism: `backdrop-filter: blur(16px)`, purple-tinted semi-transparent bg, box shadow
- Sidebar glassmorphism: dark purple bg, blur, border-left (right-side panel)
- Glassmorphism navbar/footer: `rgba(20,10,35,0.4)` with blur(10px)
- Paste not found `fadeInUp` animation
- Sidebar scrollbar custom styling
- All responsive breakpoints at 640px and 768px

### `public/css/admin.css`
- Dark purple theme matching main app: `#0a0515` base
- Stat cards with gradient icon badges (purple, blue, green, orange, cyan, pink, teal, red)
- Admin table: dark rows, purple header, hover states
- Badges: encrypted (green), password (orange), none (gray), view-once (red), expired (gray), active (green)
- Modals: glassmorphism with blur backdrop
- Code block container: dark with scroll
- Toast notifications: dark theme
- Responsive: font sizes and padding adjust at 640px/768px

## Coding Conventions

- **Python**: single quotes for strings, 4-space indent, no trailing semicolons, `logging` module (not print)
- **JavaScript**: double quotes, `const` preferred, camelCase, arrow functions for callbacks, `async/await` for fetch
- **Templates**: Jinja2 with `{{ }}` for variables, `{% %}` for control flow
- **CSS**: BEM-like selectors, media queries at bottom, no `!important` unless overriding libraries

## Commands

```bash
# Install dependencies
uv sync

# Run dev server
uv run python app.py

# Docker
docker compose up -d

# Check Python syntax
python3 -c "import py_compile; py_compile.compile('app.py', doraise=True)"

# Validate all templates
python3 -c "
from flask import Flask
app = Flask(__name__, static_folder='public', static_url_path='/')
with app.app_context():
    for name in ['index.html', 'paste.html', 'admin.html', 'admin_login.html']:
        app.jinja_env.get_template(name)
        print(f'OK: {name}')
"

# Check JS syntax (if node available)
node --check public/js/script.js
node --check public/js/admin.js
```

## Notes for LLMs

1. **Templates use Jinja2** — `{{ paste }}` is auto-escaped. Use `{{ paste | tojson }}` for JS injection (line 83 of paste.html), and `{{ paste | safe }}` only if XSS is already mitigated by context (we use `textContent` instead).
2. **Static base URL** — In dev mode, `static_base_url` resolves to `http://host:port`. In prod, it's an S3 bucket URL. The context processor handles this. Templates should always use `{{ static_base_url }}/css/styles.css` not hardcoded paths.
3. **CDN scripts are in templates** — Not in the `public/` folder. CodeMirror, highlight.js, Tailwind, Bootstrap, Chart.js, Font Awesome are loaded from CDNs. No SRI hashes (caused issues with jsdelivr).
4. **MongoDB document shape**: `{key, data, heading, language, created_at (epoch int), ip_address, open_count, password_hash?, encrypted_with?, expires_at?, view_once?, max_views?}`. `key` is indexed as unique. `password_hash` only present when password was set. `encrypted_with` is `"server"` (ENCRYPTION_KEY), `"password"` (user password), or absent (plaintext).
5. **Scheduler runs in production** — `scheduler.start()` is called both in `__main__` block and at module level. Under Gunicorn, the module-level call ensures the scheduler starts. Cleans: low-view old pastes + expired by time + viewed-once pastes.
6. **No migration needed** — Old pastes without `language` field default to `"plaintext"` in GetPaste.
7. **Ctrl+A on paste page** — Intercepted at document level but only triggers when focus is on/near the paste content area.
8. **Admin panel uses Bootstrap** — Not Tailwind. The admin panel (`admin.html`, `admin_login.html`) uses Bootstrap 5.3 for layout and components, with custom dark purple CSS in `admin.css`. The main app uses Tailwind.
9. **Admin auth is session-based** — Uses Flask's built-in session (cookie-signed with SECRET_KEY). No JWT. Session timeout is 8 hours. Logout is POST-only (not GET) to prevent CSRF logout.
10. **Encryption** — Fernet (AES-256-CBC + HMAC-SHA256). Key derived via SHA-256 of the secret. Password-protected pastes use user password as encryption key. Server-encrypted pastes use ENCRYPTION_KEY. Fernet instances are cached for performance.
11. **Reserved routes** — `GetPaste` skips keys `admin`, `api`, `health` to prevent route shadowing.
12. **Error handling** — `request.get_json(silent=True) or {}` prevents AttributeError on malformed JSON. `PyMongoError` handler returns 503. Decryption failures return placeholder text (not raw exception).
