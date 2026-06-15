# Box Connector MVP

作成日: 2026-06-15

## 実装した内容

- `DocumentSource.BOX` を追加
- Connector registryへBox Connectorを登録
- `backend/onyx/connectors/box/` を追加
- Box Client Credentials Grant認証に対応
- `root_folder_ids` 配下のfolderを再帰traverse
- file download後、既存の `extract_file_text()` へ渡して本文抽出
- Onyx `Document` としてindex可能な形式へ変換
- 基本metadataを付与
  - `box_file_id`
  - `box_folder_path`
  - `box_owner`
  - `box_size`
  - `box_modified_at`
  - `box_sha1`
- `doc_updated_at` にBox `modified_at` を利用
- Document IDを `box:file:{file_id}` に統一
- frontendのConnector一覧・設定画面・Credential formへBoxを追加
- Connector単位のPUBLIC/PRIVATE運用に限定

## 変更ファイル一覧

- `backend/onyx/configs/constants.py`
- `backend/onyx/connectors/registry.py`
- `backend/onyx/connectors/box/__init__.py`
- `backend/onyx/connectors/box/client.py`
- `backend/onyx/connectors/box/connector.py`
- `backend/onyx/connectors/box/models.py`
- `backend/tests/unit/onyx/connectors/box/test_box_connector.py`
- `web/src/lib/types.ts`
- `web/src/lib/connectors/credentials.ts`
- `web/src/lib/connectors/connectors.tsx`
- `web/src/lib/sources.ts`
- `docs/box-connector-mvp.md`

## 設定方法

管理画面でBox Credentialを作成し、以下を入力。

- `client_id`: Box AppのClient ID
- `client_secret`: Box AppのClient Secret
- `enterprise_id`: Box Enterprise ID
- `box_subject_type`: `enterprise` または `user`
- `box_subject_id`: enterprise IDまたはuser ID
- `root_folder_ids`: 取り込み対象folder ID。複数の場合はカンマ区切り

PoCでは、対象folderにBox AppのService Accountをcollaboratorとして追加する運用が確認しやすいです。

## 起動方法

通常のOnyx起動手順に従います。

```bash
docker compose up -d
```

既存環境が起動済みの場合、backend / frontend / docfetching workerを再起動してください。

## テスト方法

追加unit test:

```bash
pytest -q backend/tests/unit/onyx/connectors/box/test_box_connector.py
```

手動確認:

1. 管理画面でBox Connectorを選択
2. Box CCG Credentialを作成
3. `root_folder_ids` に対象folder IDを設定
4. ConnectorをPUBLICまたはPRIVATEで作成
5. Indexing完了後、検索またはチャットでBox文書名・本文を検索

## 未対応事項

- Box権限同期
- Box group sync
- Box comments
- Box file versions
- Box Events API
- Deep Research結果のBox保存
- DOCX/PDF export
- 大規模folder向けの高度なcheckpoint
- API rate limit専用制御

## 次に実装すべきこと

- 大規模folder向けcheckpointの細分化
- Box metadata / classification取得
- コメント取得方針の確定
- Box権限同期設計の実装
- Events APIによる増分同期
- Deep Research結果をBoxへ保存するTool
