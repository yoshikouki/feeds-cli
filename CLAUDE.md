# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What is this?

feeds-cli is a UNIX-philosophy feed reader CLI built with Bun and TypeScript. Local-first, no external APIs. Data in SQLite, config in JSON5.

### Supported Feed Formats

- RSS 2.0 (XML)
- Atom 1.0 (XML)
- JSON Feed 1.1 (JSON)
- *Future: ActivityPub/ActivityStreams*

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
├── types.ts          # All shared types (zero imports): Config, Domain, DB
├── paths.ts          # XDG path resolution (config + data dirs)
├── config/
│   └── index.ts      # JSON5 config I/O (Bun.JSON5)
├── parser/
│   └── index.ts      # Feed parser (feedsmith v3) — no db dependency
└── db/
    └── index.ts      # SQLite layer (bun:sqlite, Disposable, FTS5)
```

### Type Hierarchy

```
Config types (FeedDefinition, ConfigFile)
    ↓
Domain types (ParsedArticle, Article, FeedState, ArticleAuthor, ArticleAttachment)
    ↑
DB layer (InsertArticleInput → SQLite)
```

- Parser imports only from `types.ts` (never from `db`)
- DB imports only from `types.ts`
- `types.ts` has zero imports

### Data Locations (XDG Base Directory Spec)

- **Config**: `$XDG_CONFIG_HOME/feeds-cli/feeds.json5` (default `~/.config/feeds-cli/`)
- **Data**: `$XDG_DATA_HOME/feeds-cli/feeds.db` (default `~/.local/share/feeds-cli/`)
- CLI flags `--config`/`--db` override individual file paths

### Key Design Patterns

- **Disposable DB**: `FeedDatabase implements Disposable` — use `using db = new FeedDatabase(path)` for automatic cleanup
- **UUID feed IDs**: `feeds.id` (UUID) is the stable PK; `feeds.name` is display-only (UNIQUE index)
- **Compound dedup**: `UNIQUE(feed_id, url)` — same URL in different feeds is allowed
- **Rich normalization**: Parser extracts authors, categories, attachments, externalId, summary (separate from content), updatedAt, sourceFormat
- **Junction table tags**: `article_tags(article_id, tag)` instead of JSON column
- **FTS5**: `articles_fts` virtual table for full-text search, kept in sync via triggers

### Database Schema (bun:sqlite)

- **feeds**: id (UUID PK), name (UNIQUE), url, last_scanned_at, last_article_at, error_count, status
- **articles**: id (UUID PK), feed_id (FK → feeds, CASCADE), url, external_id, title, summary, content, authors (JSON), categories (JSON), attachments (JSON), published_at, updated_at, discovered_at, language, source_format, read, dedup_hash, UNIQUE(feed_id, url)
- **article_tags**: article_id (FK → articles, CASCADE), tag, PK(article_id, tag)
- **articles_fts**: FTS5 virtual table (title, summary, content)

### Dependencies

- `feedsmith@3.x` (RSS/Atom/JSON Feed/RDF parser, TypeScript native)

## Testing

- Tests live in `tests/`
- Unit tests: paths, config (temp files), db (`:memory:` SQLite), parser (inline XML/JSON fixtures)
- Pattern: `import { test, expect } from "bun:test";`
