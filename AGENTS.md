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
├── docker-compose.yaml     # Gunicorn 4 workers, port 5000→5000, GUNICORN_RELOAD=true
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
    │   ├── prefix-search.js # Prefix search modal (shared by index.html and paste.html)
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
    │  CodeMirror editor: live syntax colors, continuous auto-detection, hints, smart indentation, word wrap on by default
    │  Hamburger sidebar (desktop open, mobile hidden)
    │  Sidebar: title (max 40), custom key (4-40), ID prefix (1-15, live ID preview), load paste, language, description textarea (optional, max 100, multi-line), lock, expiry, view-once, max-views
    │
    ▼ POST /api/save  {data, heading, language, description?, custom_key?, prefix?, password?, expiry_value?, expiry_unit?, view_once?, max_views?}
[Flask: app.py → SavePaste]
    │  Validates size ≤ MAX_PASTE_SIZE, heading max 40, description max 100 (stored only if non-empty),
    │  validates custom_key (4-40 alphanumeric/-/_; spaces auto-replaced with `-`),
    │  validates prefix (1-15, [a-zA-Z0-9-], no `_`); key = prefix_custom_key | prefix_<random> | custom_key | <random>,
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
[Flask: app.py → GetPaste via _render_paste_page]
    │  Skips reserved keys: admin, api, health
    │  Checks: expiry passed? → delete + 404 page.  view_once + already viewed? → delete + 404.
    │  max_views reached? → delete + 404.
    │  If paste has password_hash: renders modal (no content)
    │  If no password_hash: increments open_count, decrypts if server-encrypted, renders content
    │  Passes heading, description, expires_text, view_once, max_views, created_at, encrypted_with, password_protected
    ▼
[Browser: paste.html]
    │  Navbar: left = logo + MST Bin + language + key; center = title; right = controls + info toggle
    │  If 404: "Paste Not Found" page with animation + "Create New Paste" button
    │  If locked: glassmorphism modal, POST /api/access/<key> {password} to unlock
    │  If unlocked/public: codeBlock.textContent = paste_data (XSS-safe via tojson filter)
    │  hljs.highlightElement(codeBlock)
    │  Custom line numbers synced on scroll
    │  Paste ID nav input in navbar to jump to another paste, '/' shortcut
    │  Info flyout (#infoPanel): title, description, ID, language, views, created, expiry, badges
    │  View-once floating banner when applicable; lock/expiry details live in info flyout

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
    │  View paste → /api/admin/paste/<key> (decrypts server-encrypted, shows description + placeholder for password)
    │  Delete paste → DELETE /api/admin/paste/<key>
    │  Batch delete → DELETE /api/admin/pastes {keys: [...]} (max 100, validated keys)
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
- `normalize_prefix(raw)` — trim, whitespace→`-`, strip trailing `_`
- `generate_key(prefix='')` — `[prefix_]` + random alphanumeric (`KEY_LENGTH`), reserved via a temp insert + DuplicateKeyError, max 10 retries
- `format_expiry(expires_at)` — human-readable "Expires in X days/hours/mins/secs"
- `_derive_fernet_key(secret)` — SHA-256 → base64 for Fernet key derivation
- `SERVER_FERNET` — built once at startup from `ENCRYPTION_KEY` (or `None`); read-only, safe across threads
- `_password_fernet(password)` — per-request Fernet for password pastes; never cached so password material is not retained
- `_encrypt(plaintext, fernet)` / `_decrypt(ciphertext, fernet)` — Fernet (AES-128-CBC + HMAC-SHA256); `_decrypt` raises if `fernet` is `None`
- `_remember_fresh_paste(key)` / `_consume_fresh_paste(key)` — signed-session list (last 5) of view-once/max-views pastes this browser just saved; the creator's post-save redirect consumes it instead of incrementing `open_count`
- `_delete_expired_pastes()` — shared by the admin cleanup route and the scheduler: expired by time + viewed-once + max-views reached (`$expr`); returns per-category counts
- `_render_paste_page(**kwargs)` — shared defaults for paste.html (heading, description, max_views, created_at, encrypted_with, password_protected, etc.)

**Resources**
- `SavePaste` — POST `/api/save`: validates JSON body (get_json silent=True), heading max 40 chars, description max 100 (optional, omitted from doc if empty), language whitelist, size check, password validation (no spaces, max 128), custom_key spaces→`-` then 4-40 format + uniqueness, optional `prefix` via `normalize_prefix()` + `PREFIX_REGEX` (combined as `prefix_custom_key` or passed to `generate_key(prefix)`), encrypts if password or ENCRYPTION_KEY, DuplicateKeyError handling, remembers view-once/max-views keys in the session (`_remember_fresh_paste`)
- `GET /api/search?prefix=` (`api_search_prefix`) — public, no auth. Anchored case-insensitive regex `^<escaped prefix>_` on `key`; `$nor` drops expired, consumed view-once and max-views-reached pastes; projection excludes `data`, `ip_address`, `password_hash`; sorted by `created_at` desc, limited to `PREFIX_SEARCH_LIMIT` (50) with a `total` count. Does not touch `open_count`
- `GetPaste` — GET `/<key>`: skips reserved keys (admin/api/health), checks expiry/view_once/max_views (deletes if violated), increments open_count, decrypts server-encrypted, renders paste.html via `_render_paste_page`. Skips the increment only when `_consume_fresh_paste(key)` succeeds (no public query-string bypass)
- `AccessPaste` — POST `/api/access/<key>`: checks expiry/view_once/max_views, validates password with check_password_hash, always increments open_count (consistent with GetPaste), decrypts with user password, returns description in JSON
- `Index` — GET `/`: renders index.html

**Admin Routes**
- `admin_required` decorator — checks `session['admin_logged_in']`, returns 401 JSON for API routes, redirect for page routes
- `GET/POST /admin/login` — session-based auth with hmac.compare_digest, session.clear() before login, permanent session
- `POST /admin/logout` — session.clear(), POST only (not GET, prevents CSRF logout)
- `GET /admin` — renders admin.html with username
- `GET /api/admin/pastes` — paginated list with search (re.escape), language/encryption filters, sort, server-side skip/limit
- `GET /api/admin/paste/<key>` — full detail with decryption for server-encrypted pastes
- `DELETE /api/admin/paste/<key>` — single paste deletion
- `DELETE /api/admin/pastes` — batch delete `{keys: [...]}` (max 100; each key must match `STORED_KEY_REGEX` `^[a-zA-Z0-9_-]{1,56}$`: 15-char prefix + `_` + 40-char custom key)
- `DELETE /api/admin/delete-expired` — bulk cleanup: expired by time + viewed-once + max-views (uses $expr for field comparison)
- `GET /api/admin/analytics` — total pastes, views, avg views, per-day/week/month counts, password/view-once/encrypted counts, language distribution, encryption distribution
- `GET /health` — MongoDB ping, returns `{status: "healthy/unhealthy"}`; used by the Docker `HEALTHCHECK`

**Scheduler**
- `delete_pastes()` — runs every 7 days: deletes old pastes with `open_count < 2`, then calls `_delete_expired_pastes()`
- Every Gunicorn worker starts a scheduler; `_claim_scheduled_run()` upserts on `scheduler_locks` (`_id` = job id, `next_run`) so only one worker runs each cycle. A `DuplicateKeyError` means another worker already claimed it
- `scheduler.start()` called both in `__main__` and at module level (works under Gunicorn)

### `templates/index.html`
- Tailwind 2.2 CDN + CodeMirror 5 CDN + highlight.js 11 CDN
- CodeMirror modes pre-loaded: python, javascript, xml, htmlmixed, css, clike, shell, sql, yaml, markdown, php, ruby
- Modes loaded dynamically: typescript, go, rust, swift, lua, perl, dockerfile, nginx
- **Addon dependencies**: simple-mode (needed by Rust), matchbrackets, closebrackets, closetag, show-hint (JS + CSS), anyword-hint, javascript-hint, css-hint, sql-hint, xml-hint, html-hint. Load CSS mode before htmlmixed; load xml-hint before html-hint; load addons before `script.js` initializes the editor.
- **Hamburger sidebar**: `<aside id="sidePanel">` — glassmorphism panel on right side. Desktop auto-open (pushes editor left), mobile closed by default with overlay
- **Sidebar controls**: title (maxlength 40), custom key (4-40; spaces auto-replaced with `-`), ID prefix `#keyPrefix` (maxlength 15) with `#keyPreview` showing the resulting ID, language selector, description textarea (optional, maxlength 100, multi-line, below language), lock toggle + password + eye icon, auto-delete (value + unit: sec/min/hr/day/week/month), view-once toggle, delete-after-N-views toggle
- **Navbar**: logo, paste ID + Go (load paste), Save (when sidebar closed), prefix search `#prefixSearchBtn`, new paste (`target="_blank"`, opens a new tab), about, hamburger
- **Save button**: also at sidebar bottom when open; spinner + disabled during save
- **Editor controls/status**: `#languageStatus` announces detected/selected language or loading failures; `#editorHelp` explains completions; labeled native `#wordWrap` checkbox below the language selector is checked by default. Live highlighting is the pre-save preview.
- **About modal**: feature list + keyboard shortcuts (`kbd-hint` styles); Ctrl+Shift+/ opens it in the editor, Esc closes. Ctrl+/ is reserved for toggling comments inside CodeMirror.
- Editor via `<textarea id="pasteArea">` transformed by `CodeMirror.fromTextArea()`

### `templates/paste.html`
- highlight.js 11 CDN (monokai theme)
- Paste content injected via JS: `codeBlock.textContent = {{ paste | tojson }}` — XSS safe, preserves raw characters
- **Navbar layout**: left = logo + MST Bin + language badge + paste key; title as a flex item between the groups (≥900px; truncates instead of overlapping), or on its own `.paste-nav-subtitle` row below 900px where the controls wrap onto a second row; right = paste ID nav, copy/share, views, prefix search `#prefixSearchBtn`, new paste (`target="_blank"`), info flyout toggle, about
- **Info flyout** (`#infoPanel`): toggleable right panel — title, description (if set), paste ID, language, views (/ max), created, expiry, badges (password / view-once / max views / encryption). Toggle via list icon button or Ctrl+I; Esc / overlay closes
- Custom line numbers (`#lineNumbers`) synced with pasteContent scroll
- **Password modal**: glassmorphism overlay with blur backdrop, password input with eye toggle, POST to `/api/access/<key>`; copy/share buttons un-hide after unlock
- **Paste ID nav**: input + Go button in navbar to navigate to another paste, `/` key shortcut to focus
- **Paste not found**: clean centered page with file icon, "Not Found" heading, paste key display, purple "Create New Paste" button
- **View-once indicator**: floating warning banner near content (details also in info flyout)
- **Keyboard shortcuts**: Ctrl+N new paste, Ctrl+/ about, Esc close, Ctrl+Shift+C copy content, Ctrl+I toggle info, Ctrl+A select paste only
- Copy button uses `pasteContent.innerText` (raw text, no HTML)
- About modal includes same feature list + shortcuts as index

### `templates/admin.html`
- Bootstrap 5.3 CDN + Font Awesome 6.5 + Chart.js 4.4
- **Navbar**: logo, username display, view site link, logout (POST form)
- **Analytics cards**: 8 stat cards (total pastes, total views, last 24h, protected, last week, last month, avg views, view-once)
- **Charts**: language distribution (bar), encryption distribution (doughnut)
- **Filters**: search (key/heading/IP), language dropdown, encryption filter, sort by/order, per-page selector
- **Pastes table**: checkbox column (select-all for current page) + 10 data columns (#, key, title, language, date, IP, views, encrypted, expires, actions)
- **Batch actions**: toolbar appears when any rows selected — count, Delete selected, Clear; selection persists across pages (max 100 for delete)
- **Action buttons**: view details, open paste (new tab), delete (confirmation modal)
- **Paste detail modal**: full metadata including description + content display + open link + delete button
- **Delete confirmation modal**: single key or batch key list preview
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
- **`detectLanguage(code)`**: uses `hljs.highlightAuto()` on the first 5,000 characters, relevance ≥ 3 threshold, validates against MODE_MAP; no confident match falls back to plaintext
- **`setEditorMode(language)`**: resolves MIME types via `CodeMirror.resolveMode()`, loads modes dynamically with shared promises and stale-request protection, updates the language status
- **Mode-load state**: `activeLanguage` avoids resetting the same mode; `modeLoads` shares downloads by URL; `modeRequestId` prevents late responses from overriding newer selections. Failed loads clear retry state and display feedback. Confirm the mode actually registered after download.
- **Editor assistance**: CodeMirror hint addons (automatic while typing and Ctrl+Space), smart indentation, matching/auto-closing brackets, HTML/XML tag closing; simple-mode addon supports languages such as Rust
- **Completion behavior**: automatic hints use single-line `+input` events after two word characters or `.`/`<`, skip comments/plaintext, and avoid reopening an active menu. `completeSingle: false` prevents automatic insertion of a lone suggestion. Ctrl+Space requests hints; arrow keys navigate, Enter/Tab accept, Esc dismiss. Dedicated providers cover JavaScript/CSS/SQL/HTML; other modes use available keyword/document-word hints. XML hints need schema information for tag suggestions. No language server or AI service is involved.
- **Word wrap**: `#wordWrap` checkbox is checked by default and toggles CodeMirror's `lineWrapping` without changing content
- **Wrapping scope**: editor-only display setting; no extra newlines, API fields, database fields, or browser persistence. Each new editor page starts with wrapping enabled.
- **Auto detection stays enabled**: choosing Auto Detect keeps the selector on `auto`; `#languageStatus` shows the detected language separately
- **Auto-detect trigger**: on `editor.on("change")` when `currentLanguage === "auto"` (debounced 600ms)
- **Save**: resolves "auto" language to detected before POSTing, includes optional `custom_key` and `description` if provided, heading/description length capped client-side, shows spinner + disables buttons during save, re-enables on error
- **Load paste**: navbar `#navPasteKey` + Go (same as paste viewer); spaces in ID auto-replaced with `-`; `/` focuses the input
- **Lock toggle**: shows/hides `#passwordSection`, swaps lock SVG icons, sends password in POST body
- **Expiry toggle**: shows/hides `#expirySection` (value + unit), sends expiry_value/expiry_unit in POST body
- **View-once toggle**: toggles `view_once` boolean, sends in POST body
- **Keyboard shortcuts**: Ctrl+S save, Ctrl+N new empty paste (`/`), Ctrl+Shift+K deletes current/selected lines, Ctrl+/ toggles language-aware comments, Ctrl+Shift+/ opens About, Esc closes mobile sidebar, `/` focus paste ID. CodeMirror `extraKeys` scopes delete/comment commands to the editor; Command equivalents are registered. The comment addon must load before initialization; unsupported comment syntax is a no-op.
- **Ctrl+V anywhere**: focuses editor and pastes clipboard content when no input/textarea/select is active
- **Eye icon toggle**: switches password input type between `password` and `text`
- **Custom key**: live input replaces whitespace with `-`; regex `^[a-zA-Z0-9_-]{4,40}$` after normalization; password still rejects spaces
- **Sidebar responsive**: auto-opens on desktop (>=640px), closed on mobile, overlay backdrop on mobile
- **`viewportMargin: 100`** (not Infinity) for performance with large pastes
- **ID prefix**: `PREFIX_RE` `^[a-zA-Z0-9-]{1,15}$`; `normalizePrefix()` mirrors the server; live input replaces whitespace with `-` and updates `#keyPreview` (`ID: prefix_<random>` or `prefix_customkey`); sends `prefix` in the POST body
- **Post-save redirect**: always plain `result.url` (no query string); the server-side session record decides whether the creator's first view is counted

### `public/js/prefix-search.js`
- Loaded by both `index.html` and `paste.html` after their own scripts; no-op if `#prefixSearchBtn` is missing
- Builds `#prefixSearchModal` at runtime (static markup only); results are built with `textContent`/`createElement`, never HTML from data
- Debounced (300 ms) live search plus submit; `requestSeq` + `AbortController` drop stale responses
- Prefills from the current paste ID (`<prefix>_...`) or the last searched prefix (`localStorage` key `mstbin:lastPrefix`, wrapped in try/catch)
- Results are `<a href="/<key>">` rows: key, language, badges (password, view-once, max views, encrypted), title, description, created, views, expiry; view-once rows warn that opening uses the single view
- Esc is handled in the capture phase with `stopImmediatePropagation()` so it closes only this modal; focus returns to the search button

### `public/js/admin.js`
- **Pagination state**: `currentPage`, `currentSortBy`, `currentSortOrder`, `currentSearch`, `currentLanguage`, `currentEncryption`, `perPage`
- **`loadAnalytics()`**: fetches `/api/admin/analytics`, updates 8 stat cards, updates charts
- **`loadPastes()`**: fetches `/api/admin/pastes` with all filter/sort/page params, shows loading spinner, handles empty state ("No pastes found"), error state
- **`renderPastesTable(pastes)`**: builds table HTML with `escapeHtml()` on all user data, encryption/expiry badges, action buttons
- **`renderPagination(page, totalPages, total)`**: page numbers with ellipsis, prev/next, handles empty results
- **`viewPaste(key)`**: fetches detail from `/api/admin/paste/<key>`, shows Bootstrap modal with full metadata (including description) + decrypted content
- **`showDeleteModal(key)`** / **`showBatchDeleteModal()`**: confirmation for single or multi-select delete
- **`deletePaste(key)`** / **`batchDeletePastes(keys)`**: DELETE single or batch (loading spinner on confirm)
- **Selection state**: `selectedKeys` Set; select-all toggles current page; indeterminate header checkbox; `clearSelection()`
- **`deleteExpired()`**: DELETE `/api/admin/delete-expired` with loading spinner on button
- **Charts**: Chart.js bar (languages) + doughnut (encryption)
- **`escapeHtml(text)`**: DOM-based HTML entity escaping
- **`getEncryptionBadge()`/`getExpiryBadge()`: returns styled badge HTML
- **`showToast(title, message, type)`**: Bootstrap toast notifications

### `public/css/styles.css`
- **Theme tokens on `:root`**: palette (`--violet-*`, `--fuchsia-*`, `--indigo-600`), `--bar-gradient` (shared by navbar, sidebar, footer), `--accent-line`, `--board-tint`, `--gutter-tint`, `--gradient-speed`. Change colours here, not in individual rules
- **Aurora**: `<div class="aurora">` with three `<span>` blobs is the first child of `<body>` in `index.html` and `paste.html`; fixed, `z-index: -1`, radial gradients animated with `transform` only (`auroraDriftA/B/C`). Third blob hidden ≤640px
- **Bars**: `.glassmorphism` (navbar, footer, view-once banner) and `.glassmorphism-sidebar` use `--bar-gradient` with `barGradientShift`; `#navbar::after` is the sliding accent line. Sidebar/navbar `.bg-gray-800` inputs are restyled translucent violet; Save buttons (`#saveBtnTop`, `#saveBtnSide`) get an animated violet→fuchsia gradient
- **Code board**: CodeMirror and `#pasteContent` use `--board-tint` (translucent, so the aurora shows through); `.hljs` background is transparent; gutters/line numbers use `--gutter-tint`; fuchsia glowing cursor; violet selection; focus inner glow; `boardFadeIn` (opacity only, so CodeMirror measurements are unaffected)
- **Editor layout**: `body.editor-page` is locked to `100dvh` with `overflow: hidden`; `#editorContainer` is `flex: 1 1 auto; min-height: 0` so the board fills the screen and CodeMirror scrolls internally. `#mainContent` and `footer` use `width: auto` (overriding Tailwind `w-full`) so the sidebar's `margin-right` (set by `script.js` on both) shrinks them instead of pushing them under the sidebar
- **Responsive**: viewer navbar wraps to two rows below 900px; editor navbar hides the "MST" label and tightens spacing ≤400px so the menu button stays visible at 320px
- **`prefers-reduced-motion`**: disables aurora, gradient shifts, accent line, board fade-in and hover lifts
- Completion menu overrides target `.CodeMirror-hints.monokai`, with a dark violet background and purple active row. The editor flex child uses `min-width: 0` so wrapped long lines fit the available width.
- highlight.js overrides: transparent background over `--board-tint`, monokai color palette
- Modal glassmorphism: `backdrop-filter: blur(16px)`, purple-tinted semi-transparent bg, box shadow
- Paste not found `fadeInUp` animation
- Sidebar scrollbar custom styling
- `.kbd-hint` styles for keyboard shortcut chips in About modal
- `#infoPanel` scrollbar (same pattern as `#sidePanel`)
- Responsive breakpoints: 400px (editor navbar), 640px (mobile typography, sidebar drawer), 768px, 900px (viewer navbar rows)
- Browser checks of animated pages: the in-app preview pane may not advance CSS transitions/animations, so freeze them (`*{transition:none!important;animation-duration:0s!important}`) before measuring or screenshotting layout

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

### Editor maintenance rules and verification

- Keep word wrap checked by default in the template and initialize `lineWrapping` from the checkbox state. Change the editor option rather than transforming paste text.
- Keep the user's language choice separate from the effective highlighting language. Auto Detect must remain selected and continue reacting to edits; explicit selections must take priority over pending detection/downloads.
- Resolve CodeMirror MIME types with `CodeMirror.resolveMode()`, not by splitting MIME strings. Several MIME names differ from their registered mode names.
- Preserve shared mode-download promises, registration checks, retry feedback, and stale-request protection when changing lazy loading.
- Keep suggestions non-inserting until the user accepts them, and preserve the existing save/navigation shortcuts. Describe completion coverage accurately rather than promising IDE-level semantic suggestions for every language.
- Keep Ctrl+/ for CodeMirror's `toggleComment` and Ctrl+Shift+K for `deleteLine`; use the comment addon and mode-provided syntax rather than hardcoded language markers. Keep editor About on Ctrl+Shift+/ to avoid a collision; viewer About remains Ctrl+/. Handle shifted slash (`?`) in the editor About shortcut.
- CodeMirror 5 raw `extraKeys` uses canonical modifier order: register deletion as `Shift-Ctrl-K` / `Shift-Cmd-K`. Browser checks passed for current/last/selected-line deletion and undo, Python/JS/HTML/CSS/SQL comment toggling, right Ctrl, plaintext no-op, editor-only scope, and shifted-slash About/Escape handling.
- For editor changes, check template compilation and JavaScript syntax when Node is available, then exercise the UI in a browser. Do not import `app.py` solely to validate templates: importing it connects to MongoDB, creates indexes, and starts the scheduler.
- Session browser verification passed in Chromium: all 25 code modes load; Python colors/indentation/bracket pairing; manual JS/HTML/CSS/SQL hints; automatic hints; continuous detection; stale download handling; failed-download retry; default-on wrapping/toggle; mobile sidebar; no JavaScript runtime errors. The check used a temporary Flask template/static server without MongoDB. No permanent browser-test suite or Playwright dependency was added to the repository.

### Existing application conventions

1. **Templates use Jinja2** — `{{ paste }}` is auto-escaped. Use `{{ paste | tojson }}` for JS injection (line 83 of paste.html), and `{{ paste | safe }}` only if XSS is already mitigated by context (we use `textContent` instead).
2. **Static base URL** — Controlled by `USE_CDN_STATIC`, not `FLASK_ENV`. When `USE_CDN_STATIC=true`, `static_base_url` is `STATIC_BASE_URL` (S3/CDN) and Flask does not serve `public/`. When `false`, `static_base_url` is `""` so templates resolve to relative `/css/...` paths; Flask serves `public/` locally/Docker, and on Vercel `public/**` is published via `@vercel/static` (`/css`, `/js`, `/img` routes in `vercel.json`). Templates should always use `{{ static_base_url }}/css/styles.css` not hardcoded paths.
3. **CDN scripts are in templates** — Not in the `public/` folder. CodeMirror, highlight.js, Tailwind, Bootstrap, Chart.js, Font Awesome are loaded from CDNs. No SRI hashes (caused issues with jsdelivr).
4. **MongoDB document shape**: `{key, data, heading, language, created_at (epoch int), ip_address, open_count, description?, password_hash?, encrypted_with?, expires_at?, view_once?, max_views?}`. `key` is indexed as unique. `heading` max 40 chars. `description` optional, max 100 chars, only stored when non-empty. `password_hash` only present when password was set. `encrypted_with` is `"server"` (ENCRYPTION_KEY), `"password"` (user password), or absent (plaintext).
5. **Scheduler runs in production** — `scheduler.start()` is called both in `__main__` block and at module level. Under Gunicorn, the module-level call starts the scheduler in each worker, and the `scheduler_locks` claim keeps cleanup to one run per cycle. Cleans: low-view old pastes + expired by time + viewed-once + max-views reached.
6. **No migration needed** — Old pastes without `language` default to `"plaintext"` in GetPaste; pastes without `description` simply omit it (flyout hides the field).
7. **Ctrl+A on paste page** — Intercepted at document level but only triggers when focus is on/near the paste content area.
8. **Admin panel uses Bootstrap** — Not Tailwind. The admin panel (`admin.html`, `admin_login.html`) uses Bootstrap 5.3 for layout and components, with custom dark purple CSS in `admin.css`. The main app uses Tailwind.
9. **Admin auth is session-based** — Uses Flask's built-in session (cookie-signed with SECRET_KEY). No JWT. Session timeout is 8 hours. Logout is POST-only (not GET) to prevent CSRF logout.
10. **Encryption** — Fernet (AES-128-CBC + HMAC-SHA256; the 32-byte SHA-256 digest of the secret is split into signing and encryption keys). Password-protected pastes use the user password as encryption key. Server-encrypted pastes use ENCRYPTION_KEY via the startup-built `SERVER_FERNET`. Password-derived instances are not cached.
11. **Reserved routes** — `GetPaste` skips keys `admin`, `api`, `health` to prevent route shadowing.
12. **Error handling** — `request.get_json(silent=True) or {}` prevents AttributeError on malformed JSON. `PyMongoError` handler returns 503. Decryption failures return placeholder text (not raw exception).
13. **Keyboard shortcuts** — Documented in About modals: Ctrl+S save, Ctrl+N new paste; editor Ctrl+Shift+K delete line, Ctrl+/ toggle comment, Ctrl+Shift+/ About; viewer Ctrl+/ About, Ctrl+Shift+C copy, Ctrl+I paste info; Esc close modals/panels, `/` focus paste ID. Do not use Ctrl+Shift+I (browser DevTools).
14. **Custom key / title limits** — Custom key: spaces/whitespace auto-replaced with `-`, then must match `^[a-zA-Z0-9_-]{4,40}$` (client + server). Prefix: 1-15 of `[a-zA-Z0-9-]` (no `_`, it is the separator), trailing `_` stripped. Stored keys can be up to 56 chars. Title truncated to 40 chars. Description truncated to 100 chars. Load-paste ID inputs also normalize spaces→`-`.
15. **Prefix search is public** — anyone who knows or guesses a prefix sees titles, descriptions and dates of its pastes (never content). Treat prefixes as labels, not secrets. There is no rate limiting on `/api/search`.
16. **New paste `+` icon opens a new tab** — both navbars use `target="_blank" rel="noopener"`. The logo and Ctrl+N still navigate in the same tab.
