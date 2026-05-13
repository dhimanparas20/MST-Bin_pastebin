# MST Bin - Modern Pastebin Clone

MST Bin is a modern, feature-rich pastebin clone that allows users to share text snippets with automatic 7-day expiration. Built with Flask and MongoDB, it features a sleek dark theme interface with syntax highlighting, line numbers, and keyboard shortcuts.

## Screenshots

### Homepage
![Homepage](static/img/ss1.png)
*Homepage with dark theme, CodeMirror syntax-highlighted editor, and language selector*

### Paste View
![Paste View](static/img/ss2.png)
*Individual paste view with highlight.js syntax coloring*

## Features

- 🌙 Dark theme interface
- 🎨 **Live syntax highlighting** in the editor (CodeMirror 5 + monokai theme)
- 🔍 **Auto language detection** — paste code and language is automatically identified
- 🏷️ **Language selector** — 25+ languages (Python, JS, Go, Rust, SQL, YAML, Dockerfile, etc.)
- 📝 Line numbers
- ⌨️ Keyboard shortcuts (Ctrl+S to save, Ctrl+A selects only paste content)
- 🔄 One-click copy button on paste view
- 📏 **Size limit** — configurable max paste size (default 10,000 chars)
- 🗜️ **Gzip compression** on all HTML/JSON responses > 500 bytes
- 🕐 Unix epoch timestamps for efficient storage
- 🧹 Auto-cleanup of inactive pastes (< 2 views in 7 days)
- 🎨 Glassmorphism design
- 📱 Responsive layout

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Flask + Flask-RESTful |
| Database | MongoDB (PyMongo) |
| Editor | CodeMirror 5 (CDN) |
| Viewer highlighting | highlight.js 11 (CDN) |
| Styling | TailwindCSS 2.2 + custom CSS |
| Compression | Python gzip (stdlib) |
| Scheduling | APScheduler |
| Deployment | Docker + Docker Compose |

## Prerequisites

- Python 3.8+
- MongoDB
- Docker (optional)

## Environment Variables

Create a `.env` file in the root directory:

```env
MONGO_CONNECTION_STRING=mongodb://localhost:27017
MONGO_DB_NAME=pastebin
MONGO_COLLECTION_NAME=pastes
KEY_LENGTH=6
MAX_PASTE_SIZE=10000
EXPIRATION_HOURS=24
FLASK_DEBUG=False
FLASK_PORT=5000
FLASK_HOST=0.0.0.0
SECRET_KEY=your_secret_key
FLASK_ENV=dev
STATIC_BASE_URL=/
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_CONNECTION_STRING` | — | MongoDB connection URI (**required**) |
| `MONGO_DB_NAME` | `pastebin` | Database name |
| `MONGO_COLLECTION_NAME` | `pastes` | Collection name |
| `KEY_LENGTH` | `6` | Length of generated paste keys |
| `MAX_PASTE_SIZE` | `10000` | Maximum characters per paste |
| `FLASK_DEBUG` | `False` | Enable Flask debug mode |
| `FLASK_PORT` | `5000` | Server port |
| `FLASK_HOST` | `0.0.0.0` | Server bind address |
| `SECRET_KEY` | — | Flask session secret |
| `FLASK_ENV` | `dev` | `dev` or `prod` |
| `STATIC_BASE_URL` | `/` | S3 bucket URL in production |

## Quick Start

```bash
# Clone and enter the repo
git clone <repo-url> && cd MST-Bin_pastebin

# Set up environment
cp env_sample .env
# Edit .env with your MongoDB connection string

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Editor homepage |
| `POST` | `/api/save` | Save a paste `{"data":"...", "heading":"...", "language":"python"}` |
| `GET` | `/<key>` | View a paste with syntax highlighting |
