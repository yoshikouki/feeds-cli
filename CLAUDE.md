# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

feeds-cli is a UNIX-philosophy RSS/Atom feed reader CLI built with Bun and TypeScript. Local-first, no external APIs. Data in SQLite, config in JSON5.

## Commands

```bash
bun install              # Install dependencies
bun test                 # Run all tests
bun test tests/db.test.ts  # Run a single test file
bun run src/index.ts     # Run the CLI
bun run src/index.ts add "HN" "https://news.ycombinator.com/rss"  # Example usage
```

## Bun Runtime Rules

- Always use `bun` instead of `node`, `ts-node`, `npm`, `yarn`, `pnpm`, `npx`
- Use `bun:sqlite` (not better-sqlite3), `Bun.file`/`Bun.write` (not node:fs readFile/writeFile)
- Bun auto-loads .env — don't use dotenv
- For Bun API details: `node_modules/bun-types/docs/**.mdx`

## Architecture

```
src/
├── index.ts          # Entry point: runCli(argv, deps?) → exit code
├── types.ts          # All shared TypeScript types
├── commands/
│   ├── index.ts      # Command dispatcher + handlers (add, remove, scan, list, read, etc.)
│   └── helpers.ts    # Output formatting, arg parsing, duration parsing
├── config/
│   └── index.ts      # JSON5 config I/O (~/.config/feeds-cli/feeds.json5)
├── db/
│   └── index.ts      # SQLite layer: articles + feeds tables
└── feed/
    ├── index.ts      # scanFeeds orchestration, URL normalization, dedup
    ├── parser.ts     # RSS 2.0 / Atom 1.0 XML parsing (fast-xml-parser)
    └── scrape.ts     # HTML scraping with CSS selectors (linkedom)
```

### Key Design Patterns

- **Dependency injection for testability**: `runCli` accepts `CliDeps` (stdout, stderr, fetchImpl, now) so tests can mock I/O and time
- **Dual output**: Every command supports `--format json` for machine consumption; default is human-readable tab-separated
- **Exit codes**: 0 = success, 1 = error (scriptable)
- **Dedup by URL**: Articles are unique by normalized URL (hash stripped, default ports removed); `INSERT OR IGNORE` in SQLite

### Data Flow

```
feeds.json5 → scan → fetch URL → detect format →
  ├── XML → parser.ts (RSS 2.0 or Atom 1.0)
  └── HTML (if scrape config) → scrape.ts (CSS selector)
→ normalize & dedup → SQLite (articles + feeds tables)
→ list/read commands query SQLite → stdout
```

### Database Schema (bun:sqlite)

- **articles**: id (PK), feed_name, url (UNIQUE), title, content, published_at, discovered_at, read, tags (JSON), dedup_hash
- **feeds**: name (PK), url, last_scanned_at, last_article_at, error_count, status (active|dead|error)

## Testing

- Tests live in `tests/` with fixtures in `tests/fixtures/`
- Integration test (`cli.test.ts`): uses temp files and mocked fetch to test full CLI workflow
- Unit tests: db operations (`:memory:` SQLite), XML parser with fixture files
- Pattern: `import { test, expect } from "bun:test";`

## Dependencies

| Package | Purpose |
|---------|---------|
| fast-xml-parser | RSS/Atom XML parsing |
| json5 | Config file format (supports comments) |
| linkedom | HTML DOM parsing for scraping |
