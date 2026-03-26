# feeds-cli

UNIX 哲学に基づくローカル完結のニュースフィード CLI。Bun + TypeScript。

RSS 2.0 / Atom 1.0 / JSON Feed 1.1 / HTML スクレイピングに対応。設定は JSON5、記事ストアは SQLite。外部 API 不要。

## インストール

```bash
bun install
```

## データの保存先

[XDG Base Directory Spec](https://specifications.freedesktop.org/basedir-spec/latest/) に準拠:

| 種類 | パス | 環境変数 |
|------|------|---------|
| 設定 | `~/.config/feeds-cli/feeds.json5` | `$XDG_CONFIG_HOME` |
| データ | `~/.local/share/feeds-cli/feeds.db` | `$XDG_DATA_HOME` |

`--config <path>` / `--db <path>` フラグで個別に上書き可能。

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
