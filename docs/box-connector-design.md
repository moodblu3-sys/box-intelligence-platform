# Box Connector Design

調査日: 2026-06-15  
目的: OnyxへBox Connectorを追加し、Boxを企業コンテンツ層として検索可能にする。

## 結論

Box Connectorは実装可能。  
推奨は段階導入。

1. Phase 1: Boxファイル検索・取り込み
2. Phase 2: folder階層・metadata・comments
3. Phase 3: 権限同期
4. Phase 4: Events APIによる高精度な増分同期
5. Phase 5: Deep Research生成物のBox保存

## Box APIとの適合性

| 要件 | Box API | 適合性 | 備考 |
|---|---|---:|---|
| サーバー認証 | Client Credentials Grant | 高 | Onyx Credential方式と相性良好 |
| ファイル一覧 | Folder items / Search | 高 | root `0` からtraverse可能 |
| ファイル本文 | Download file content | 高 | 既存のfile extraction pipelineへ接続 |
| メタデータ | File info / Metadata instances | 高 | `fields` またはmetadata endpoints |
| コメント | List file comments | 中 | 取得可。本文へ含めるか別Document化は設計判断 |
| 権限 | Collaborations / Groups / Users | 中〜高 | 継承・共有リンクの扱いに注意 |
| バージョン | File versions | 中 | 検索対象にするかmetadata扱いか判断 |
| 増分同期 | Events API | 中 | enterprise eventsはlong polling不可 |
| レポート保存 | Upload file / Upload version | 高 | Tool/Workflow化が自然 |

## 認証設計

### 推奨: Client Credentials Grant

Credential項目:

- `client_id`
- `client_secret`
- `enterprise_id`
- `box_subject_type`
  - `enterprise`
  - `user`
- `box_subject_id`
  - enterprise IDまたはuser ID
- optional
  - `root_folder_ids`
  - `include_comments`
  - `include_versions`
  - `use_events_incremental`

Box公式仕様では、CCGで `grant_type=client_credentials` を使い、enterprise主体なら `box_subject_type=enterprise` と `box_subject_id=<enterprise_id>` を指定する。user主体の場合は `box_subject_type=user` とuser IDを指定し、必要なアプリ設定が必要。

### 認証上の注意

- enterprise全体を扱うにはアプリ認可・scope・管理者権限の確認が必要。
- Service Accountのroot folderだけでは企業コンテンツ全体が見えない可能性がある。
- Managed Userを横断する場合、ユーザー代理またはenterprise search権限が必要。
- MVPでは「指定folderにアプリ/サービスアカウントをcollaboratorとして追加」する方式が最も検証しやすい。

## ファイル取得方法

### MVP

- `GET /folders/{folder_id}/items`
- folderなら再帰
- fileならmetadata取得後にdownload
- rootは `0`

メリット:

- 実装が明快
- Dropbox Connectorに近い
- folder単位導入がしやすい

デメリット:

- 企業全体の網羅性は設定次第
- 削除・移動検知は弱い
- 大規模テナントではfull crawlが重い

### 強化版

- Box Search API
  - `enterprise_content` scopeが使える場合は横断検索に有効
- Box Events API
  - `stream_position` をcheckpointに保存
  - 作成/更新/削除/移動/権限変更イベントを処理

推奨:

- 初回はfolder traversal。
- 2回目以降はEvents APIまたはmodified_at filter。
- Events未対応環境では定期full crawl + hash/timestamp skip。

## メタデータ取得方法

取得候補:

- file standard fields
  - `id`
  - `name`
  - `description`
  - `size`
  - `created_at`
  - `modified_at`
  - `owned_by`
  - `path_collection`
  - `sha1`
  - `file_version`
  - `shared_link`
- metadata instances
  - `GET /files/{file_id}/metadata`
  - template指定取得も可
- classification
  - security classification metadata

Onyx mapping:

- `semantic_identifier`: Box file name
- `doc_updated_at`: `modified_at`
- `metadata`
  - `box_file_id`
  - `box_folder_path`
  - `box_owner`
  - `box_size`
  - `box_sha1`
  - `box_version_id`
  - `box_classification`
- `primary_owners`: `owned_by.login`
- `parent_hierarchy_raw_node_id`: parent folder ID

## コメント取得可否

可。  
Box APIに `GET /files/{file_id}/comments` がある。

設計選択:

### A. ファイル本文の末尾にコメントを含める

- 実装は簡単。
- コメントも検索対象になる。
- コメント更新だけでファイル全体再indexが必要。

### B. コメントを別Documentとしてindex

- 更新・削除・権限管理が明確。
- file本体とコメントの引用が分かれる。
- Deep Researchで「本文」と「議論」を区別できる。

推奨:

- Phase 2ではA。
- コメント重要度が高い業務ではPhase 3以降にBへ拡張。

## 権限取得可否

可。ただし設計難度は高い。

取得候補:

- file collaborations
- folder collaborations
- group memberships
- users
- shared link visibility

Onyxへの変換:

- User collaboration
  - `ExternalAccess.external_user_emails`
- Group collaboration
  - `ExternalAccess.external_user_group_ids`
- Shared link
  - company/domain限定なら社内public相当
  - anyone linkなら `is_public=True` だが、企業要件により無効化推奨
- Folder inherited permissions
  - folder IDを外部groupとして扱い、group syncでfolder membersへ解決

重要な論点:

- Boxのwaterfall permissionをどう表現するか。
- 外部コラボレーターをOnyxユーザーとして扱うか。
- shared linkをOnyx上でpublic扱いにしてよいか。
- 退職・無効ユーザーの扱い。

推奨:

- `treat_shared_link_as_public=false` をデフォルト。
- file collaboration + folder collaboration + Box groupを同期。
- 権限が判断できない文書は `ExternalAccess.empty()` に倒す。

## バージョン管理対応可否

可。  
Box APIに file versions endpointがある。

設計選択:

### A. 最新版のみindex

- 推奨MVP。
- Onyxの通常検索体験に合う。
- `file_version.id` をmetadataに保持。

### B. 過去versionもmetadataに保持

- 監査・比較には有効。
- 検索対象は最新版のみ。

### C. 各versionを別Documentとしてindex

- 完全な履歴検索が可能。
- index量が増える。
- Deep Researchで古い内容が混ざるリスク。

推奨:

- Phase 1: A
- Phase 3以降: 必要に応じてB
- Cは規制業務など明確な要件がある場合のみ。

## Connector構成案

```text
backend/onyx/connectors/box/
  __init__.py
  connector.py
  client.py
  models.py
  doc_conversion.py
  file_retrieval.py

backend/ee/onyx/external_permissions/box/
  doc_sync.py
  group_sync.py
  permission_utils.py
```

### Connector class

```text
BoxConnector(
  CheckpointedConnectorWithPermSync[BoxCheckpoint],
  SlimConnectorWithPermSync,
  Resolver
)
```

### Checkpoint

候補フィールド:

- `has_more`
- `mode`
  - `folder_walk`
  - `events`
- `folder_queue`
- `current_folder_id`
- `current_offset`
- `seen_item_ids`
- `stream_position`
- `last_event_id`

### Document ID

推奨:

```text
box:file:{file_id}
```

version別indexを採用する場合:

```text
box:file:{file_id}:version:{version_id}
```

## MVPスコープ

含める:

- CCG認証
- 指定folder配下のfile/folder traversal
- ファイル本文抽出
- `modified_at` による差分
- `HierarchyNode`
- 基本metadata
- 最新versionのみ
- Connector単位の `PUBLIC/PRIVATE`

含めない:

- 権限同期
- コメント
- Events API
- version履歴検索
- Boxへのレポート保存

## 推奨スコープ

企業向けPoCでは、MVPだけでは不十分。  
最低限、以下をPhase 2で入れる。

- `SYNC` access type
- file/folder collaboration取得
- group sync
- commentsの本文取り込み
- Events APIの調査・限定導入

## 参照

- Box CCG: https://developer.box.com/guides/authentication/client-credentials
- Box folder items: https://developer.box.com/reference/get-folders-id-items
- Box file info: https://developer.box.com/reference/get-files-id
- Box file metadata: https://developer.box.com/reference/get-files-id-metadata
- Box comments: https://developer.box.com/reference/get-files-id-comments
- Box collaborations: https://developer.box.com/reference/get-files-id-collaborations
- Box versions: https://developer.box.com/reference/get-files-id-versions
- Box events: https://developer.box.com/reference/get-events
- Box upload: https://developer.box.com/reference/post-files-content

