# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What is this?

feeds-cli is a UNIX-philosophy RSS/Atom feed reader CLI built with Bun and TypeScript. Local-first, no external APIs. Data in SQLite, config in JSON5.

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test tests/db.test.ts  # Run a single test file
```

## Bun Runtime Rules

- Always use `bun` instead of `node`, `ts-node`, `npm`, `yarn`, `pnpm`, `npx`
- Use `bun:sqlite` (not better-sqlite3), `Bun.file`/`Bun.write` (not node:fs readFile/writeFile)
- Use `Bun.JSON5` for JSON5 parse/stringify (not json5 package)
- Bun auto-loads .env — don't use dotenv

## Architecture

```
src/
├── types.ts          # All shared TypeScript types (zero imports)
├── paths.ts          # XDG path resolution (config + data dirs)
├── config/
│   └── index.ts      # JSON5 config I/O (Bun.JSON5)
└── db/
    └── index.ts      # SQLite layer (bun:sqlite, Disposable)
```

### Data Locations (XDG Base Directory Spec)

- **Config**: `$XDG_CONFIG_HOME/feeds-cli/feeds.json5` (default `~/.config/feeds-cli/`)
- **Data**: `$XDG_DATA_HOME/feeds-cli/feeds.db` (default `~/.local/share/feeds-cli/`)
- CLI flags `--config`/`--db` override individual file paths

### Key Design Patterns

- **Disposable DB**: `FeedDatabase implements Disposable` — use `using db = new FeedDatabase(path)` for automatic cleanup
- **Dedup by URL**: Articles are unique by normalized URL; `INSERT OR IGNORE` in SQLite

### Database Schema (bun:sqlite)

- **articles**: id (PK), feed_name, url (UNIQUE), title, content, published_at, discovered_at, read, tags (JSON), dedup_hash
- **feeds**: name (PK), url, last_scanned_at, last_article_at, error_count, status (active|dead|error)

## Testing

- Tests live in `tests/`
- Unit tests: paths, config (temp files), db (`:memory:` SQLite)
- Pattern: `import { test, expect } from "bun:test";`
