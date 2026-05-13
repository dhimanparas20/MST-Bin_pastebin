# AGENTS.md — Project Guide for AI Assistants

## Project Overview

MST Bin is a pastebin web app: users paste text/code, get a shareable link. Flask backend + MongoDB + vanilla JS frontend with CodeMirror/highlight.js for syntax highlighting.

## Directory Structure

```
.
├── app.py                  # Flask app: routes, API, scheduler, gzip middleware
├── pyproject.toml          # Project dependencies (uv)
├── uv.lock                 # Locked dependency versions
├── Dockerfile              # Docker image
├── docker-compose.yaml     # Gunicorn 4 workers, port 80→5000
├── env_sample              # Template for .env file
├── vercel.json             # Vercel deployment config
├── README.md               # Human-facing docs
├── templates/
│   ├── index.html          # Editor page (CodeMirror + language selector)
│   └── paste.html          # Paste view page (highlight.js + line numbers)
└── public/
    ├── css/
    │   └── styles.css      # Custom styles: glassmorphism, CodeMirror overrides, responsive
    ├── js/
    │   └── script.js       # Editor logic: CodeMirror init, language detection, save
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
    │  Sidebar: title, custom key, load paste, language, lock toggle, expiry, view-once
    │
    ▼ POST /api/save  {data, heading, language, custom_key?, password?, expiry_value?, expiry_unit?, view_once?, max_views?}
[Flask: app.py → SavePaste]
    │  Validates size ≤ MAX_PASTE_SIZE, validates custom_key (4-20 alphanumeric/-/_, no spaces),
    │  checks uniqueness if custom_key provided, else generates random key,
    │  hashes password with werkzeug.security if provided (no spaces allowed),
    │  calculates expires_at from expiry_value+expiry_unit (sec/min/hr/day/week/month),
    │  sets view_once flag if requested,
    │  created_at = int(time.time())  (Unix epoch)
    │
    ▼ 302 redirect /<key>
[Browser: paste.html]
    │  GET /<key>
    ▼
[Flask: app.py → GetPaste]
    │  Checks: expiry passed? → delete + 404 page.  view_once + already viewed? → delete + 404.
    │  max_views reached? → delete + 404.
    │  If paste has password_hash: renders modal (no content)
    │  If no password_hash: increments open_count, renders content
    │  Passes expires_text ("Expires in X days") and view_once flag to template
    ▼
[Browser: paste.html]
    │  If 404: beautiful "Paste Not Found" page with animation + "Create New Paste" button
    │  If locked: glassmorphism modal, POST /api/access/<key> {password} to unlock
    │  If unlocked/public: codeBlock.textContent = paste_data (XSS-safe via tojson filter)
    │  hljs.highlightElement(codeBlock)
    │  Custom line numbers synced on scroll
    │  Paste ID nav input in navbar to jump to another paste, '/' shortcut
    │  Displays expiry timer, view-once indicator, lock indicator in navbar
```

## Key Files

### `app.py`
- **Flask app** with Flask-RESTful for clean resource classes
- **`@app.context_processor`** injects `static_base_url` into all templates (local dev vs S3 prod)
- **`@app.after_request`** gzips HTML/JSON responses > 500 bytes (zlib, level 6)
- **`SavePaste`** — POST `/api/save`, expects JSON `{data, heading, language, custom_key?, password?, expiry_value?, expiry_unit?, view_once?}`. Returns `{url}` or `{error}` with 400/409
  - If `custom_key` is provided: validates format `^[a-zA-Z0-9_-]{4,20}$`, checks no spaces, checks uniqueness in DB, returns 409 "already taken" on conflict
  - If `custom_key` is omitted/empty: generates a random key (collision-safe, retries on conflict)
  - If `password` is provided: validated no spaces, hashed with `werkzeug.security.generate_password_hash()`, stored as `password_hash`
  - If `expiry_value` + `expiry_unit` provided: calculates `expires_at` epoch timestamp (max: 86400s/1440m/720h/365d/52w/12m)
  - If `view_once` is true: sets flag, paste deletes after first view
  - If `max_views` is provided: sets limit, paste deletes after N views
- **`generate_key()`** — generates a random alphanumeric key of `KEY_LENGTH` length, retries until a unique key is found
- **`format_expiry(expires_at)`** — returns human-readable string like "Expires in 3 days"
- **`GetPaste`** — GET `/<key>`, renders `paste.html`. Returns 404 page if not found. Checks `expires_at` (delete if past) and `view_once` (delete if open_count > 0). If paste has `password_hash`, renders without content with `password_required=True`
- **`AccessPaste`** — POST `/api/access/<key>`, expects `{password}`. Also checks expiry and view_once before returning. Verifies against `password_hash`, returns paste data on success or 403
- **`Index`** — GET `/`, renders `index.html`
- **`delete_pastes()`** — APScheduler job every 7 days: deletes pastes with `open_count < 2` AND `created_at < now - 7 days` (using epoch timestamps)
- **`MAX_PASTE_SIZE`** from env (default 10000 chars)

### `templates/index.html`
- Tailwind 2.2 CDN + CodeMirror 5 CDN + highlight.js 11 CDN
- CodeMirror modes pre-loaded: python, javascript, xml, htmlmixed, css, clike, shell, sql, yaml, markdown, php, ruby
- Modes loaded dynamically: typescript, go, rust, swift, lua, perl, dockerfile, nginx
- **Hamburger sidebar**: `<aside id="sidePanel">` — glassmorphism panel on right side. Desktop auto-open (pushes editor left), mobile closed by default with overlay
- **Sidebar controls**: title input, custom key, load paste + Go, language selector, lock toggle + password + eye icon, auto-delete (value + unit: sec/min/hr/day/week/month), view-once toggle, delete-after-N-views toggle
- **Save button**: in sidebar bottom when open, in top navbar when sidebar closed
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

### `public/js/script.js`
- **`MODE_MAP`**: internal language name → CodeMirror MIME type
- **`DYNAMIC_MODES`**: languages that load mode scripts lazily
- **`HLJS_ALIAS_MAP`**: maps highlight.js language names to internal names (e.g., `"c++"→"cpp"`)
- **`MODE_PARENT_MAP`**: maps MIME-derived names to parent modes (e.g., `"csrc"→"clike"`)
- **`detectLanguage(code)`**: uses `hljs.highlightAuto()`, relevance ≥ 3 threshold, validates against MODE_MAP
- **`setEditorMode(language)`**: checks `CodeMirror.modes` for loaded modes (using parent map), loads dynamically if needed
- **Auto-detect trigger**: on `editor.on("change")` when `currentLanguage === "auto"` (debounced 600ms)
- **Save**: resolves "auto" language to detected before POSTing, includes optional `custom_key` if provided
- **Load paste**: reads key from `#loadPasteKey`, navigates to `/<key>`
- **Lock toggle**: shows/hides `#passwordSection`, swaps lock SVG icons, sends password in POST body
- **Expiry toggle**: shows/hides `#expirySection` (value + unit), sends expiry_value/expiry_unit in POST body
- **View-once toggle**: toggles `view_once` boolean, sends in POST body
- **Ctrl+V anywhere**: focuses editor and pastes clipboard content when no input/textarea/select is active
- **Eye icon toggle**: switches password input type between `password` and `text`
- **Space validation**: client-side checks that custom key, paste ID, password contain no spaces
- **Sidebar responsive**: auto-opens on desktop (>=640px), closed on mobile, overlay backdrop on mobile

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

## Coding Conventions

- **Python**: single quotes for strings, 4-space indent, no trailing semicolons
- **JavaScript**: double quotes, `const` preferred, camelCase, arrow functions for callbacks
- **Templates**: Jinja2 with `{{ }}` for variables, `{% %}` for control flow (currently minimal usage)
- **CSS**: BEM-like selectors, media queries at bottom, no `!important` unless overriding libraries

## Commands

```bash
# Install dependencies
uv sync

# Run dev server
uv run python app.py

# Docker
docker compose up -d

# Check syntax
python3 -c "import py_compile; py_compile.compile('app.py', doraise=True)"

# Template validation
python3 -c "
from flask import Flask
app = Flask(__name__, static_folder='public', static_url_path='/')
with app.app_context():
    for name in ['index.html', 'paste.html']:
        app.jinja_env.get_template(name)
"
```

## Notes for LLMs

1. **Templates use Jinja2** — `{{ paste }}` is auto-escaped. Use `{{ paste | tojson }}` for JS injection (line 83 of paste.html), and `{{ paste | safe }}` only if XSS is already mitigated by context (we use `textContent` instead).
2. **Static base URL** — In dev mode, `static_base_url` resolves to `http://host:port`. In prod, it's an S3 bucket URL. The context processor handles this. Templates should always use `{{ static_base_url }}/css/styles.css` not hardcoded paths.
3. **CDN scripts are in templates** — Not in the `public/` folder. CodeMirror, highlight.js, and Tailwind are loaded from cdnjs. This avoids bundling large libraries.
4. **MongoDB document shape**: `{key, data, heading, language, created_at (epoch int), ip_address, open_count, password_hash?, expires_at?, view_once?, max_views?}`. No `_id` needed for queries (use `key` field). `key` can be either auto-generated (random) or user-provided (custom_key). `password_hash` is only present when a password was set.
5. **Scheduler cleans old pastes** — Pastes with `< 2 views AND > 7 days old` are deleted. Uses epoch comparison.
6. **No migration needed** — Old pastes without `language` field will default to `"plaintext"` in GetPaste.
7. **Ctrl+A on paste page** — Intercepted at document level but only triggers when focus is on/near the paste content area, preventing navbar/footer from being selected.
