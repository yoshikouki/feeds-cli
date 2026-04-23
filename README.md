# feeds-cli

UNIX 哲学に基づくローカル完結のニュースフィード CLI。Bun + TypeScript。

RSS 2.0 / Atom 1.0 / JSON Feed 1.1 / HTML スクレイピングに対応。設定は JSON5、記事ストアは SQLite。外部 API 不要。

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
