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
Domain types (ParsedArticle, Article, FeedState, FeedGroup, ScanLogEntry, ArticleAuthor, ArticleAttachment)
    ↑
DB layer (InsertArticleInput → SQLite)
```

- `SourceKind` is the unified type for feed source kinds and source formats: `"rss" | "atom" | "json" | "rdf" | "scrape" | "activitypub"`
- Parser imports only from `types.ts` (never from `db`)
- DB imports only from `types.ts`

### Data Locations (XDG Base Directory Spec)

- **Config**: `$XDG_CONFIG_HOME/feeds-cli/feeds.json5` (default `~/.config/feeds-cli/`)
- **Data**: `$XDG_DATA_HOME/feeds-cli/feeds.db` (default `~/.local/share/feeds-cli/`)
- CLI flags `--config`/`--db` override individual file paths

### Key Design Patterns

- **Disposable DB**: `FeedDatabase implements Disposable` — use `using db = new FeedDatabase(path)` for automatic cleanup
- **UUID feed IDs**: `feeds.id` (UUID) is the stable PK; `feeds.name` is display-only (UNIQUE index)
- **Canonical + Occurrences**: `canonical_articles` holds deduplicated article metadata; `article_occurrences` preserves per-source fidelity (title, content, authors as JSON)
- **Content separation**: `article_contents` table stores article body separately from `canonical_articles` for list query performance
- **Normalized relations**: `article_authors` and `article_categories` are junction tables for cross-article queries; occurrence JSON preserved for source fidelity
- **FTS5 standalone**: `canonical_articles_fts` is a standalone FTS5 table (not external content mode), managed by application code — no triggers
- **Feed groups**: `feed_groups` with self-referencing `parent_id` for tree structure; `feed_group_memberships` for many-to-many
- **Scan history**: `scan_log` accumulates per-source scan history; `feed_source_states` is the fast-access current state cache
- **Compound dedup**: `UNIQUE(feed_source_id, source_url)` — same URL in different sources is allowed
- **Junction table tags**: `article_tags(canonical_article_id, tag)` instead of JSON column

### Database Schema (bun:sqlite, Drizzle ORM)

**Core:**
- **feeds**: id (UUID PK), name (UNIQUE), created_at, updated_at
- **feed_aliases**: feed_id (FK), alias — historical name tracking
- **feed_sources**: id (PK), feed_id (FK), position, name, kind, url, scrape_config (JSON)
- **feed_source_tags**: feed_source_id (FK), tag
- **feed_source_states**: feed_source_id (PK, FK), status, error_count, last_scanned_at, last_article_at, last_error

**Groups:**
- **feed_groups**: id (PK), name, parent_id (self-ref FK, CASCADE), position
- **feed_group_memberships**: feed_id (FK), group_id (FK), position

**Articles:**
- **canonical_articles**: id (PK), canonical_url (indexed), dedup_hash (unique when not null), title, summary, language, published_at, updated_at, first_discovered_at, last_seen_at
- **article_contents**: canonical_article_id (PK, FK), content, updated_at
- **article_occurrences**: id (PK), canonical_article_id (FK), feed_id (FK), feed_source_id (FK), source_url, title, summary, content, authors (JSON), categories (JSON), attachments (JSON), source_format, UNIQUE(feed_source_id, source_url)
- **article_authors**: id (PK), canonical_article_id (FK), name, url, email, position — indexed on name
- **article_categories**: canonical_article_id (FK), category — PK(canonical_article_id, category)
- **article_tags**: canonical_article_id (FK), tag — PK(canonical_article_id, tag)
- **article_states**: canonical_article_id (PK, FK), read_at, archived_at, starred_at

**Observability:**
- **scan_log**: id (PK), feed_source_id (FK), scanned_at, status, article_count, error_message, duration_ms
- **canonical_articles_fts**: FTS5 standalone (canonical_article_id UNINDEXED, title, summary, content)

### Dependencies

- `feedsmith@3.x` (RSS/Atom/JSON Feed/RDF parser, TypeScript native)

## Testing

- Tests live in `tests/`
- Unit tests: paths, config (temp files), db (`:memory:` SQLite), parser (inline XML/JSON fixtures)
- Pattern: `import { test, expect } from "bun:test";`
