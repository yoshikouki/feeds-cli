# feeds-cli

`feeds-cli` は、RSS/Atom と HTML スクレイピングをローカル完結で扱う Bun-native なニュースフィード CLI です。設定は JSON5、記事ストアは SQLite で管理します。

## インストール

```bash
bun install
```

## 使い方

```bash
feeds add "HN" "https://news.ycombinator.com/rss"
feeds scan
feeds list --unread
feeds list --unread --format json
feeds read <article-id>
feeds list-feeds --format json
```

HTML スクレイプを使う場合:

```bash
feeds add "Example Blog" "https://example.com/blog" --scrape-selector "a.post-link" --tags tech,blog
```

## 共通フラグ

- `--config <path>`: 設定ファイルのパス。デフォルトは `~/.config/feeds-cli/feeds.json5`
- `--db <path>`: SQLite DB のパス。デフォルトは `~/.config/feeds-cli/feeds.db`
- `--format json`: JSON 出力
- `--quiet`, `-q`: 成功時の出力を抑制

## 設定ファイル

```json5
{
  feeds: [
    {
      name: "Example Blog",
      url: "https://example.com/feed.xml",
      tags: ["tech"],
    },
    {
      name: "Scrape Target",
      url: "https://example.com/blog",
      scrape: {
        selector: "a.post-link",
      },
      tags: ["tech"],
    },
  ],
}
```

## 開発

```bash
bun test
```
