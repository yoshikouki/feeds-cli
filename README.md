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

実行履歴と control-plane の状態変化は `feeds log` で確認できます。

```bash
feeds log cycles --json
feeds log scans --json
feeds log events --json
feeds log hooks --json
feeds log jobs --json
```

コマンドが失敗した場合、stderr に原因と次の行動を含む診断情報を出力します。
JSON モードでは同じ診断情報を構造化して返します。

```json
{
  "error": {
    "schemaVersion": 1,
    "code": "usage.unknown_command",
    "category": "usage",
    "summary": "Unknown command: nope",
    "reason": "The requested command is not registered.",
    "suggestedAction": "Run 'feeds --help' to list available commands.",
    "exitCode": 2,
    "context": {
      "command": "nope"
    }
  }
}
```

非 JSON モードでは次のように表示します。

```text
error[usage.unknown_command]: Unknown command: nope
reason: The requested command is not registered.
next: Run 'feeds --help' to list available commands.
context:
  command: nope
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
