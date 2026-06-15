# Existing Connectors Analysis

調査日: 2026-06-15  
対象: Google Drive / Dropbox / SharePoint / Slack  
Onyx: `44b7a5c`

## 比較サマリ

| Connector | 認証方式 | データ取得 | 権限管理 | 増分同期 | 実装量 |
|---|---|---|---|---|---:|
| Google Drive | OAuth / Service Account | Drive API、folder crawl、shared drive、My Drive | file/folder permissions、Workspace group | 独自checkpoint + 更新時刻 | 約4,860行 |
| Dropbox | Access token | folder再帰 + download | 実装なし | `client_modified`時間窓 | 約184行 |
| SharePoint | MSAL client secret / certificate | Graph API + SharePoint REST、delta API | role assignments、AD/SharePoint group | Graph delta + checkpoint | 約4,197行 |
| Slack | Bot token | conversations list/history/replies | channel members、user email | channel/timestamp checkpoint | 約2,611行 |

実装量はconnector本体と関連helper、EE権限同期の概算。

## Google Drive

### 認証方式

- OAuth credentialsまたはService Account。
- `load_credentials()` でprimary admin emailを読み、`get_google_creds()` でcredential生成。
- Service Accountの場合、必要に応じてWorkspaceユーザーをimpersonate。
- 権限同期にはGoogle Workspace Admin権限が必要。

### データ取得方式

- Shared Drive / My Drive / Shared with me / specific folderを設定で切替。
- Drive APIのfile listingを使い、取得済みfolder/file IDをcheckpointで管理。
- folder階層は `HierarchyNode` として保存。
- 本文はGoogle Docs変換、通常ファイルの抽出、tabular/image処理に分岐。

### 権限管理

- 初回index時に `ExternalAccess` を付与可能。
- EEのdoc syncでfile/folder permissionsを再取得。
- folderを外部groupとして扱い、継承権限を表現。
- Workspace groupはgroup syncでemailメンバーへ解決。

### 増分同期

- `GoogleDriveCheckpoint` が処理stage、取得済みID、folder walk状態を保持。
- 時間窓 `start/end` を受け取り、更新対象を絞る。
- 失敗時はcheckpointから再開。

### 実装量

- `backend/onyx/connectors/google_drive/connector.py`: 2,279行
- 関連helper: 約1,995行
- EE権限同期: 約1,050行
- 合計: 約4,860行

### Boxへの示唆

- Boxの本命モデル。
- folder階層、継承権限、group sync、初回権限付与の設計が近い。

## Dropbox

### 認証方式

- `dropbox_access_token` のみ。
- `load_credentials()` でDropbox clientを作成。

### データ取得方式

- rootから `files_list_folder()` を再帰実行。
- fileは `files_download()` で取得。
- shared linkがなければ作成。
- `extract_file_text()` で本文抽出。

### 権限管理

- 外部権限同期なし。
- Documentには `external_access` を入れない。
- Onyx上はConnector単位の `PUBLIC/PRIVATE` に依存。

### 増分同期

- `client_modified` を `start/end` でフィルタ。
- checkpointなし。
- 削除検知や権限変化には弱い。

### 実装量

- `backend/onyx/connectors/dropbox/connector.py`: 184行

### Boxへの示唆

- Box MVPを最短で作るならこの型。
- ただし企業コンテンツ層としては権限・削除・共有・大規模運用が不足。

## SharePoint

### 認証方式

- MSAL confidential client。
- client secretまたはcertificate。
- 権限同期にはcertificate-based authenticationが前提とされる。

### データ取得方式

- Microsoft Graph APIでsite/drive/itemを取得。
- SharePoint REST/Office365 SDKを権限取得に併用。
- drive単位ではGraph delta APIを使う。
- folder指定時はBFS traversalへ切替。
- Site pagesもオプションで取得。

### 権限管理

- 初回index時にpermissions取得可能。
- SharePoint role assignmentsを `ExternalAccess` に変換。
- SharePoint group / AD groupを外部groupとしてsync。
- site/folder/file階層の権限を扱う。

### 増分同期

- 非folder-scoped driveではdelta API。
- checkpointに `current_drive_delta_next_link` を保持。
- delta token期限切れ時はfull enumerationへfallback。

### 実装量

- `backend/onyx/connectors/sharepoint/connector.py`: 3,207行
- `connector_utils.py`: 48行
- EE権限同期: 約942行
- 合計: 約4,197行

### Boxへの示唆

- 大規模・企業権限・差分同期の設計が近い。
- Box Events APIを使う場合はSharePoint delta設計が参考になる。

## Slack

### 認証方式

- Slack bot token。
- `CredentialsConnector` を使い、Credential Provider経由でtokenを読む。
- Redis retry handlerでrate limit/retryを制御。

### データ取得方式

- channel一覧取得。
- conversations historyでmessage取得。
- threadはconversations repliesで取得。
- channelを `HierarchyNode`、message/threadをDocumentとして扱う。

### 権限管理

- public/private channelのアクセスを `ExternalAccess` に変換。
- private channelはmember email一覧。
- Slack usergroupはdoc accessでは基本使わず、channel memberをemailへ展開。
- Enterprise Gridではteam単位のuser email mapを扱う。

### 増分同期

- `SlackCheckpoint`
  - channel IDs
  - channel completion timestamp
  - current channel
  - seen thread timestamp
- Slackは新しいmessageから古いmessageへ返すため、timestampを調整しながら進める。

### 実装量

- `backend/onyx/connectors/slack/connector.py`: 1,596行
- helper: 約734行
- EE権限同期: 約611行
- 合計: 約2,611行

### Boxへの示唆

- 動的credential/provider、rate limit、checkpoint設計が参考になる。
- Box Connector本体にはSlackほど会話特有の処理は不要。

## Box実装で流用すべきパターン

- Google Drive
  - folderを外部groupとして扱う権限継承モデル
  - `SlimConnectorWithPermSync`
  - `Resolver`
- SharePoint
  - API cursor/delta URLをcheckpointへ保存
  - 大規模sourceでのper-page checkpoint
  - file download size cap
- Slack
  - `CredentialsConnector` の動的Credential運用
  - rate limit/retryの考え方
- Dropbox
  - 最小MVPの構成

## 参照

- `backend/onyx/connectors/google_drive/`
- `backend/onyx/connectors/dropbox/connector.py`
- `backend/onyx/connectors/sharepoint/`
- `backend/onyx/connectors/slack/`
- `backend/ee/onyx/external_permissions/google_drive/`
- `backend/ee/onyx/external_permissions/sharepoint/`
- `backend/ee/onyx/external_permissions/slack/`

