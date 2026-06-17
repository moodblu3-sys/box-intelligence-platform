# Knowledge Desk Demo Script

## 面接デモ手順

### 1. 位置づけを説明

説明:

Knowledge Deskは、Onyxの上に乗る情シス問い合わせAIアプリです。OnyxがBox、SharePoint、Jiraを横断検索し、Knowledge Deskが問い合わせ業務向けに回答、confidence、エスカレーション判定、Jira ticket draftへ正規化します。

見せるポイント:

- Onyx本体に業務ロジックを混ぜていない
- `apps/knowledge-desk-api/` に独立アプリとして実装
- MVPではTeams BotとJira API本実装はまだ作らない

### 2. デモデータを説明

今回の問い合わせは、1つのsourceだけでは回答が完成しない。

| Source | 役割 | デモファイル |
|---|---|---|
| Box | 正式な外部共有ルール | `docs/demo-data/box_external_sharing_policy.md` |
| SharePoint | 社員向けFAQと確認手順 | `docs/demo-data/sharepoint_it_faq.md` |
| Jira | 過去問い合わせと解決履歴 | `docs/demo-data/jira_resolution_history.md` |

### 3. APIを起動

Mock mode:

```bash
cd apps/knowledge-desk-api
npm run start
```

Real Onyx mode:

```bash
cd apps/knowledge-desk-api
KNOWLEDGE_DESK_ONYX_MODE=real \
ONYX_BASE_URL=http://localhost:3100 \
ONYX_API_KEY=<personal-access-token-or-api-key> \
npm run start
```

面接デモでは、まずMock modeでアプリ単体の動作を見せる。その後、実OnyxにBox / SharePoint / Jiraのデモデータがindex済みであればReal modeへ切り替える。

起動確認:

```bash
curl -sS http://localhost:8787/health
```

期待結果:

```json
{
  "status": "ok",
  "service": "knowledge-desk-api"
}
```

### 4. デモ質問を送る

```bash
curl -sS http://localhost:8787/api/knowledge-desk/query \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "suzuki@nisshin-tech.example",
    "channel": "teams",
    "question": "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。"
  }'
```

## デモ質問

```text
取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。
外部共有の条件と、確認すべき手順を教えてください。
```

## 期待回答

回答では、次の内容が含まれる。

1. フォルダの機密区分が外部共有可能か確認する。
2. 共有リンクではなく、必要に応じて外部コラボレーター招待を使う。
3. 招待先メールアドレスと相手のログインメールアドレスが一致しているか確認する。
4. 取引先ドメインが許可リストに登録されているか確認する。
5. 招待メールが迷惑メール扱いになっていないか確認する。
6. 共有リンクの場合は、有効期限、パスワード、リンク対象範囲を確認する。
7. ドメイン未登録、社外秘フォルダ、退職済みオーナーの場合は情シスへエスカレーションする。

## 引用元source

期待されるsource:

- Box: Box外部共有運用ルール
- SharePoint: 外部ユーザーがBoxにアクセスできない場合のFAQ
- Jira: BOX-1423 取引先ドメイン未登録によるアクセス不可

この3sourceが揃ることで、正式ルール、社員向け手順、過去事例をまとめた回答になる。

## 成功時の見せ方

確認ポイント:

- `sources` にBox、SharePoint、Jiraが含まれる
- 各sourceに `snippet` と `score` が含まれる
- `confidence` が高い
- `needsEscalation=false`
- `jiraTicketDraft=null`

説明:

このケースでは、正式ルール、FAQ、過去解決履歴が揃っているため、社員に一次回答できる。情シス担当者は個別対応せず、社員自身が確認手順を進められる。

## 解決できない場合のJira ticket draft表示

情報不足の質問を投げる。

```bash
curl -sS http://localhost:8787/api/knowledge-desk/query \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "suzuki@nisshin-tech.example",
    "channel": "teams",
    "question": "社内VPNが海外出張先からつながりません。原因を教えてください。"
  }'
```

期待結果:

- `sources=[]`
- `confidence < 0.6`
- `needsEscalation=true`
- `escalationReason` が返る
- `jiraTicketDraft` が返る

説明:

MVPではJira APIを呼ばない。AIが勝手に起票するのではなく、起票用draftを返し、将来はTeams上で確認してからJira APIで作成する。

## 将来像

1. Teams Botを入口にする。
2. Onyx実APIに接続し、実際のBox、SharePoint、Jira Connectorの検索結果を使う。今回の次フェーズで `RealOnyxClient` を追加済み。
3. ユーザー権限に応じて参照可能なsourceだけで回答する。
4. 解決できない場合はJira ticket draftをTeamsに表示する。
5. 情シス担当者の承認後、Jira APIでチケットを作成する。
6. 解決済みチケットを再びOnyxへindexし、次回以降の回答品質を上げる。

## Box AI単体との差別化トーク

Box AIはBox内文書の理解に強い。一方、情シス問い合わせでは、Boxの正式ルールだけでなく、SharePointのFAQとJiraの過去解決履歴が必要になる。

Knowledge Deskは、Boxを中心にしながら、SharePointとJiraの文脈を合わせて回答する。さらに、confidenceが低い場合はJira ticket draftまで出せるため、単なる文書要約ではなく、問い合わせ解決プロセスに接続できる。
