# Knowledge Desk API

## 概要

Knowledge Desk APIは、社員からの問い合わせを受け取り、Onyx経由でBox、SharePoint、Jiraのナレッジを横断検索し、情シス問い合わせ向けに正規化した回答を返す。

既定では `MockOnyxClient` を利用する。`KNOWLEDGE_DESK_ONYX_MODE=real` を指定すると、実Onyx APIへ接続する `RealOnyxClient` に切り替わる。

## 起動

```bash
cd apps/knowledge-desk-api
npm run start
```

既定ポートは `8787`。変更する場合は `KNOWLEDGE_DESK_PORT` または `PORT` を指定する。

```bash
KNOWLEDGE_DESK_PORT=8790 npm run start
```

## Onyx接続モード

### Mock mode

固定デモデータで動かす。外部Onyxへの接続は不要。

```bash
KNOWLEDGE_DESK_ONYX_MODE=mock npm run start
```

`KNOWLEDGE_DESK_ONYX_MODE` 未指定時もmock modeで起動する。

### Real mode

実Onyxへ問い合わせる。

```bash
KNOWLEDGE_DESK_ONYX_MODE=real \
ONYX_BASE_URL=http://localhost:3100 \
ONYX_API_KEY=<personal-access-token-or-api-key> \
npm run start
```

`ONYX_BASE_URL` はブラウザから使っているOnyxのURLを指定する。ローカルDocker環境では `http://localhost:3100` を想定。

`ONYX_API_KEY` はOnyxのPersonal Access TokenまたはAPI Key。Knowledge Deskは以下のHeaderでOnyxへ送る。

```http
Authorization: Bearer <ONYX_API_KEY>
```

推奨scope:

- Chat Write
- 必要に応じて Search Read

実Onyxでは次のendpointを呼ぶ。

```http
POST /api/chat/send-chat-message
```

`stream=false` で呼び出し、`top_documents` と `tool_calls[].search_docs` からsourceを抽出する。

## Endpoint

### POST /api/knowledge-desk/query

社員からの問い合わせを受け付ける。

### Request

```json
{
  "user": "suzuki@nisshin-tech.example",
  "channel": "teams",
  "question": "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。"
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| user | string | yes | 問い合わせユーザー |
| channel | string | yes | 問い合わせチャネル。MVPでは `teams` を想定 |
| question | string | yes | 社員からの質問文 |

### Response

```json
{
  "answer": "外部取引先がBoxフォルダにアクセスできない場合は、まず共有方法とフォルダの機密区分を確認してください...",
  "sources": [
    {
      "source": "Box",
      "title": "Box外部共有運用ルール",
      "url": "box://policies/external-sharing",
      "snippet": "日新テクノロジー株式会社では、Boxフォルダを外部取引先に共有する場合...",
      "score": 0.94
    },
    {
      "source": "SharePoint",
      "title": "外部ユーザーがBoxにアクセスできない場合のFAQ",
      "url": "sharepoint://it-faq/box-external-user-access",
      "snippet": "外部ユーザーがBoxにアクセスできない場合は、招待メールの宛先...",
      "score": 0.91
    },
    {
      "source": "Jira",
      "title": "BOX-1423 取引先ドメイン未登録によるアクセス不可",
      "url": "jira://BOX-1423",
      "snippet": "取引先ドメインがBox外部共有の許可リストに登録されておらず...",
      "score": 0.88
    }
  ],
  "confidence": 0.95,
  "needsEscalation": false,
  "escalationReason": null,
  "jiraTicketDraft": null
}
```

| Field | Type | Description |
|---|---|---|
| answer | string | 社員に返す回答 |
| sources | SourceReference[] | 回答根拠 |
| confidence | number | 0から1の信頼度 |
| needsEscalation | boolean | 情シス担当者へのエスカレーションが必要か |
| escalationReason | string \| null | エスカレーション理由 |
| jiraTicketDraft | JiraTicketDraft \| null | Jira起票用draft。MVPではJira APIは呼ばない |

## SourceReference

```json
{
  "source": "Box",
  "title": "Box外部共有運用ルール",
  "url": "box://policies/external-sharing",
  "snippet": "外部共有では、機密区分、招待先メールアドレス、取引先ドメイン許可を確認します。",
  "score": 0.91
}
```

`source` は `Box`、`SharePoint`、`Jira` のいずれか。

`snippet` と `score` は任意項目。既存の `source` / `title` / `url` は維持するため、既存クライアントとの互換性は壊さない。

## JiraTicketDraft

```json
{
  "title": "Box外部共有に関する問い合わせ: 取引先がアクセスできない",
  "description": "...",
  "priority": "Medium",
  "labels": ["box", "external-sharing", "knowledge-desk"],
  "assigneeTeam": "Corporate IT"
}
```

## Confidence判定ルール

MVPではルールベースで判定する。

- sourceが0件なら低confidence
- Box / SharePoint が揃うと加点
- Jiraの過去解決履歴が見つかると加点
- Box / SharePoint / Jira の3種類が揃えば高confidence
- usableなsnippetが多い場合は加点
- snippetが短すぎる、または少なすぎる場合は減点
- 平均scoreが高い場合は加点、低い場合は減点
- Jiraがない場合は「過去解決履歴が不足」として減点
- 回答に「不明」「確認が必要」「担当部門へ確認」「判断できません」「情報不足」が含まれる場合は減点
- confidenceは0.15から0.95の範囲に丸める

## Escalation判定ルール

MVPでは `confidence < 0.6` の場合に `needsEscalation=true` とする。

sourceが0件の場合:

```json
{
  "needsEscalation": true,
  "escalationReason": "関連するBox、SharePoint、Jiraのナレッジが見つからないため、情シス部門で確認が必要です。"
}
```

sourceはあるが根拠が弱い場合:

```json
{
  "needsEscalation": true,
  "escalationReason": "回答根拠が不足しており、誤案内の可能性があるため、情シス部門で確認が必要です。"
}
```

## サンプルcurl

```bash
curl -sS http://localhost:8787/api/knowledge-desk/query \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "suzuki@nisshin-tech.example",
    "channel": "teams",
    "question": "取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。"
  }'
```

## テスト

```bash
cd apps/knowledge-desk-api
npm run test
```

確認対象:

- Mock modeで高confidence回答が返る
- 情報不足時に `needsEscalation=true` と `jiraTicketDraft` が返る
- `SourceReference` に `snippet` / `score` が含まれる
- `RealOnyxClient` がOnyx chat APIレスポンスを正規化できる

情報不足時の動作確認:

```bash
curl -sS http://localhost:8787/api/knowledge-desk/query \
  -H 'Content-Type: application/json' \
  -d '{
    "user": "suzuki@nisshin-tech.example",
    "channel": "teams",
    "question": "社内VPNが海外出張先からつながりません。原因を教えてください。"
  }'
```
