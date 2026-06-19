# Knot 面接デモ設計

## デモの狙い

Knotを、Onyx OSSをベースにした「社内ナレッジ問い合わせAI」として見せる。

単なる検索ではなく、Box / SharePoint / Jiraを横断して問い合わせに回答し、解決できない場合はJiraへ起票するところまで見せる。

## 1時間の基本構成

| 時間 | 内容 | 見せるもの |
|---|---|---|
| 0-5分 | 導入 | スライド1 |
| 5-10分 | 課題とユースケース | スライド2 |
| 10-17分 | アーキテクチャ | スライド3 |
| 17-40分 | メイン実演 | Knot UI / Knowledge Desk API / Box・SharePoint・Jira引用 |
| 40-50分 | 未解決時のJira起票デモ | Knowledge Desk API → Jira Issue URL |
| 50-55分 | 技術的な工夫と今後 | スライド5 |
| 55-60分 | QA | 必要ならGitHubを少しだけ表示 |

## 5枚スライド構成

### 1. Knotとは

目的：
Knotの全体像を一言で伝える。

入れる内容：

- Product name: Knot
- Tagline: 社内ナレッジをつなぐAIデスク
- Built on Onyx OSS
- Box / SharePoint / Jiraなどを横断して回答
- 回答できない場合はJira起票へ接続

### 2. 課題とユースケース

目的：
なぜこのアプリが必要かを伝える。

入れる内容：

- 社内資料が複数SaaSに分散
- 社員問い合わせが情シスに集中
- 過去の解決履歴が再利用されない
- 生成AIを使いたいが、権限・根拠・運用が課題
- デモ題材：Box外部共有で取引先がアクセスできない

### 3. アーキテクチャ

目的：
技術力を短時間で伝える。

入れる内容：

- Onyx OSSを検索・RAG基盤として利用
- Box Connector MVPを追加実装
- SharePoint / Jira / Teamsなど既存Connectorを利用
- Knowledge Desk APIをOnyxの上に独立アプリとして追加
- 未解決時はJira APIでIssue起票

### 4. デモシナリオ

目的：
実演前に何を見るかを明確にする。

入れる内容：

- 社員がTeamsから質問する想定
- KnotがBox / SharePoint / Jiraを横断検索
- 回答、根拠、確認手順を返す
- 情報不足ならJiraに起票
- 情シスの一次対応を効率化

### 5. 技術的な工夫と今後

目的：
実装力と発展性を伝える。

入れる内容：

- Box Connectorの実装
- APIエラー分類、retry/backoff、失敗隔離
- Knowledge Desk APIの独立実装
- Jira起票の安全設計
- 今後：権限同期、Events API、Teams Bot、実運用向け監査ログ

## メインデモ質問

```text
取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。
```

期待する見せ場：

- Boxの正式ルールを引用
- SharePoint FAQの確認手順を引用
- Jiraの過去問い合わせを引用
- 回答が「手順」としてまとまる
- 情シス担当者が次に何をすべきか分かる

## Jira起票デモ質問

```text
上記を確認しても解決できません。情シスに対応依頼を起票してください。
```

期待する見せ場：

- `needsEscalation=true`
- Jira Issue作成
- Issue URLを返す
- タイトル、説明、優先度、ラベルが自動生成される

## 当日見せないもの

- GitHubのコード深掘り
- Google系Connector
- Box Export
- Box権限同期
- Events API
- コメント・バージョン履歴

## 失敗時の逃げ道

| 失敗箇所 | 逃げ道 |
|---|---|
| LLM APIが失敗 | Knowledge Desk APIのMock応答を見せる |
| ConnectorがIndexedにならない | 事前スクショとデモデータファイルを見せる |
| Jira起票が失敗 | DRY_RUNのdraft表示に切り替える |
| UIが崩れる | APIレスポンスとスライド中心に切り替える |
