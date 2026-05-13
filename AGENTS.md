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
    │  CodeMirror editor, language select, custom key (optional), load paste by ID
    │
    ▼ POST /api/save  {data, heading, language, custom_key?}
[Flask: app.py → SavePaste]
    │  Validates size ≤ MAX_PASTE_SIZE, validates custom_key (4-20 alphanumeric/-/_),
    │  checks uniqueness if custom_key provided, else generates random key,
    │  created_at = int(time.time())  (Unix epoch)
    │
    ▼ 302 redirect /<key>
[Browser: paste.html]
    │  GET /<key>
    ▼
[Flask: app.py → GetPaste]
    │  Increments open_count, renders paste.html with paste, heading, language
    ▼
[Browser: paste.html]
    │  codeBlock.textContent = paste_data (XSS-safe via tojson filter)
    │  hljs.highlightElement(codeBlock)
    │  Custom line numbers synced on scroll
```

## Key Files

### `app.py`
- **Flask app** with Flask-RESTful for clean resource classes
- **`@app.context_processor`** injects `static_base_url` into all templates (local dev vs S3 prod)
- **`@app.after_request`** gzips HTML/JSON responses > 500 bytes (zlib, level 6)
- **`SavePaste`** — POST `/api/save`, expects JSON `{data, heading, language, custom_key?}`. Returns `{url}` or `{error}` with 400/409
  - If `custom_key` is provided: validates format `^[a-zA-Z0-9_-]{4,20}$`, checks uniqueness in DB, returns 409 "already taken" on conflict
  - If `custom_key` is omitted/empty: generates a random key (collision-safe, retries on conflict)
- **`generate_key()`** — generates a random alphanumeric key of `KEY_LENGTH` length, retries until a unique key is found
- **`GetPaste`** — GET `/<key>`, renders `paste.html`. Returns 404 if not found
- **`Index`** — GET `/`, renders `index.html`
- **`delete_pastes()`** — APScheduler job every 7 days: deletes pastes with `open_count < 2` AND `created_at < now - 7 days` (using epoch timestamps)
- **`MAX_PASTE_SIZE`** from env (default 10000 chars)

### `templates/index.html`
- Tailwind 2.2 CDN + CodeMirror 5 CDN + highlight.js 11 CDN
- CodeMirror modes pre-loaded: python, javascript, xml, htmlmixed, css, clike, shell, sql, yaml, markdown, php, ruby
- Modes loaded dynamically: typescript, go, rust, swift, lua, perl, dockerfile, nginx
- **Language selector** `<select id="languageSelect">` — 25 languages + "Auto Detect"
- **Custom key input** `<input id="customKey">` — optional, 4-20 chars (a-z, A-Z, 0-9, -, _), validated client+server side
- **Load paste input** `<input id="loadPasteKey">` + "Go" button — navigates to paste by key/ID
- Editor via `<textarea id="pasteArea">` transformed by `CodeMirror.fromTextArea()`
- `#lineNumbers` div is hidden (CodeMirror provides its own gutter)
- `updateMainPadding()` adjusts margin-top to match navbar height

### `templates/paste.html`
- highlight.js 11 CDN (monokai theme)
- Paste content injected via JS: `codeBlock.textContent = {{ paste | tojson }}` — XSS safe, preserves raw characters
- Language badge in navbar: `<span id="langBadge">{{ language }}</span>`
- Custom line numbers (`#lineNumbers`) synced with pasteContent scroll
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

### `public/css/styles.css`
- CodeMirror overrides: black background `#000`, monospace font, custom gutter colors
- CodeMirror selection: blue tint when focused, white tint otherwise
- highlight.js overrides: black background, monokai color palette
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
4. **MongoDB document shape**: `{key, data, heading, language, created_at (epoch int), ip_address, open_count}`. No `_id` needed for queries (use `key` field). `key` can be either auto-generated (random) or user-provided (custom_key).
5. **Scheduler cleans old pastes** — Pastes with `< 2 views AND > 7 days old` are deleted. Uses epoch comparison.
6. **No migration needed** — Old pastes without `language` field will default to `"plaintext"` in GetPaste.
7. **Ctrl+A on paste page** — Intercepted at document level but only triggers when focus is on/near the paste content area, preventing navbar/footer from being selected.
