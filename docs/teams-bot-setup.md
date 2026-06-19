# Teams Bot設定手順

## 位置づけ

Knotで作るものはTeams Botである。

Azure Botは、TeamsからKnotのAPIへメッセージを中継するための登録・チャネル設定である。つまり、ユーザー体験としてはTeams Bot、接続基盤としてAzure Bot Serviceを使う。

## 構成

```text
Microsoft Teams
  -> Azure Bot Service
  -> Knowledge Desk API
  -> Onyx
  -> Box / SharePoint / Jira
```

Knowledge Desk API側の受信endpoint:

```text
POST /api/knowledge-desk/teams/bot/messages
```

ローカル起動時:

```text
http://localhost:8787/api/knowledge-desk/teams/bot/messages
```

Teamsから呼ぶ場合はHTTPS公開URLが必要。

```text
https://xxxxx.trycloudflare.com/api/knowledge-desk/teams/bot/messages
```

## 1. Knowledge Desk APIを起動

```bash
cd apps/knowledge-desk-api
npm run start:env
```

ローカル確認:

```bash
npm run smoke:teams-bot:env
```

`TEAMS_BOT_REPLY_MODE=http` の場合、Teamsへ実返信は送らず、HTTP responseでBot形式の回答を確認する。

## 2. HTTPS公開

例:

```bash
cloudflared tunnel --url http://localhost:8787
```

表示されたURLを控える。

```text
https://xxxxx.trycloudflare.com
```

## 3. Azure Botを作成

Azure Portalで作成する。

```text
Create a resource
-> Azure Bot
```

推奨設定:

| 項目 | 値 |
|---|---|
| Bot handle | knot-knowledge-desk |
| App type | Single Tenant |
| Messaging endpoint | https://xxxxx.trycloudflare.com/api/knowledge-desk/teams/bot/messages |

作成後、以下を控える。

```text
Microsoft App ID
Microsoft App Password / Client Secret
Microsoft App Tenant ID
```

## 4. Teams Channelを有効化

Azure Botの画面で以下を設定する。

```text
Channels
-> Microsoft Teams
-> Enable
```

## 5. .envを設定

`apps/knowledge-desk-api/.env` に追加する。

```env
TEAMS_BOT_REPLY_MODE=connector
MICROSOFT_APP_TYPE=SingleTenant
MICROSOFT_APP_ID=...
MICROSOFT_APP_PASSWORD=...
MICROSOFT_APP_TENANT_ID=...
```

既存のOnyx / Jira設定も必要。

```env
KNOWLEDGE_DESK_ONYX_MODE=real
ONYX_BASE_URL=http://localhost:3100
ONYX_API_KEY=...
JIRA_BASE_URL=https://moodblu3.atlassian.net
JIRA_EMAIL=...
JIRA_API_TOKEN=...
JIRA_PROJECT_KEY=CIH
```

## 6. TeamsにBotを追加

Azure BotのTeams Channel画面、またはTeams管理画面からBotを追加する。

個人チャットで以下を送る。

```text
取引先にBoxフォルダを共有したいのですが、相手からアクセスできないと言われています。外部共有の条件と、確認すべき手順を教えてください。
```

期待結果:

- Knotが回答する
- Box / SharePoint / Jiraのsourceが表示される
- confidenceが高い場合は `needsEscalation=false`
- 回答後に「この回答で解決しましたか？」と確認される
- `解決しません` を選ぶ、または返信するとJira起票結果が返る

未解決時の確認:

```text
解決しません
```

`JIRA_DRY_RUN=false` の場合、直前の問い合わせ内容、Bot回答、参照元を含むJira Issueを作成する。
`JIRA_DRY_RUN=true` の場合は起票せず、DRY_RUNとして返る。

## デモでの説明

説明は短くする。

```text
Teams上ではBotとして見えます。裏側ではAzure Bot ServiceがTeamsのメッセージをKnowledge Desk APIへ中継し、Knowledge DeskがOnyxでBox、SharePoint、Jiraを横断検索しています。
回答後に解決確認を行い、解決しない場合は直前の問い合わせ内容をもとにJiraへ起票します。
```

## 注意

- `.env` はpushしない
- `MICROSOFT_APP_PASSWORD` は画面に再表示されないため、作成時に保存する
- `TEAMS_BOT_REPLY_MODE=http` はローカル確認用
- `TEAMS_BOT_REPLY_MODE=connector` がTeams実返信用
- 本番化する場合は、受信リクエストのBot Framework認証検証を追加する
