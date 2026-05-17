# feeds-cli

UNIX 哲学に基づくローカル完結のニュースフィード CLI。Bun + TypeScript。

RSS 2.0 / Atom 1.0 / JSON Feed 1.1 / Sitemap 0.9 に対応。設定は JSON5、記事ストアは SQLite。外部 API 不要。

## インストール

```bash
bun install
bun link        # `feeds` コマンドをグローバルに登録
```

## データの保存先

デフォルトでは、すべてのファイルを `~/.feeds-cli/` 配下に保存します:

| 種類 | パス |
|------|------|
| 設定 | `~/.feeds-cli/feeds.json5` |
| データ | `~/.feeds-cli/feeds.db` |
| フック | `~/.feeds-cli/hooks/cron/` |

`--base-dir <path>` でワークスペース全体を切り替えられます。
また、`--config <path>` / `--db <path>` で個別に上書き可能です。

## CLI 出力

デフォルトは人間向けのテキスト出力です。機械可読な結果が必要な場合は
`--json` を指定します。既存の `--format json` も同じ意味で使えます。

```bash
feeds list --json
feeds cron status --format json
```

JSON モードでコマンドが失敗した場合、stderr に `what` / `why` / `how`
を含む構造化エラーを出力します。

```json
{
  "error": {
    "code": "usage_error",
    "what": "Unknown command: nope",
    "why": "The provided arguments do not match the CLI contract.",
    "how": "Run 'feeds --help' or the command help, then retry with valid arguments.",
    "details": {
      "message": "Unknown command: nope\nRun 'feeds --help' for usage.",
      "exitCode": 2
    }
  }
}
```

## 設定ファイル

```json5
{
  feeds: [
    {
      name: "HN",
      sources: [
        {
          id: "hn-main",
          name: "main",
          url: "https://news.ycombinator.com/rss",
          tags: ["tech"],
        },
      ],
    },
  ],
}
```

## 開発

```bash
bun test
```
