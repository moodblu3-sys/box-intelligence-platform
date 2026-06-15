# Implementation Roadmap

調査日: 2026-06-15  
目的: OnyxベースのBox Deep Research Platform実装ロードマップ。

## 全体方針

- いきなり全社権限同期まで作らない。
- まずBox Connector MVPで「Box文書がOnyx Deep Researchに使える」ことを確認。
- その後、権限同期・増分同期・Box保存を段階的に強化。

## Phase 0: 技術検証

期間目安: 3〜5営業日

目的:

- Box API認証と対象データ範囲を確定。
- Onyx Connector追加点を確定。

作業:

- Box CCG app作成
- enterprise subject / user subjectのアクセス範囲確認
- 指定folder traversal検証
- file download検証
- collaboration取得検証
- API rate limit確認
- OnyxローカルでConnector登録箇所確認

成果物:

- Box API疎通メモ
- Credential設計
- MVP対象folder/ユーザー範囲

Exit条件:

- 指定folder配下のファイル一覧・本文・metadataが取得できる。
- CCG Credentialの運用方式が決まる。

## Phase 1: Box Connector MVP

期間目安: 1〜2週間

目的:

- Box文書をOnyxへindexし、Internal Search / Deep Researchで使える状態にする。

実装範囲:

- `DocumentSource.BOX`
- Connector registry登録
- backend connector
- frontend connector設定
- CCG credential form
- 指定folder traversal
- file download
- text extraction
- basic metadata
- `doc_updated_at=modified_at`
- checkpoint
- `PUBLIC/PRIVATE` access type

対象外:

- 権限同期
- comments
- versions履歴
- Events API
- Box保存

検証:

- 小規模folder
- 大きめPDF/DOCX/XLSX
- 更新ファイルの再index skip
- 削除/移動時の挙動確認
- Deep Researchでcitationが出ること

Exit条件:

- Box文書を検索できる。
- Deep ResearchがBox文書を引用できる。
- 失敗時にcheckpointから再開できる。

## Phase 2: Metadata / Comments / Hierarchy強化

期間目安: 1〜2週間

目的:

- Boxを企業コンテンツ層として使いやすくする。

実装範囲:

- `HierarchyNode`の整備
- path_collectionのmetadata化
- Box custom metadata取得
- classification取得
- comments取得
- owners/created_by/modified_by整備
- file size cap
- retry/rate limit対応

設計判断:

- commentsは初期は本文末尾へ統合。
- 将来、コメントを別Document化できるようmetadataにcomment IDsを持つ。

Exit条件:

- 検索結果にBox folder path / owner / classificationが出せる。
- コメント内容も検索に寄与する。

## Phase 3: 権限同期

期間目安: 2〜4週間

目的:

- Onyx上でBoxのアクセス権を反映。

実装範囲:

- `AccessType.SYNC`対応
- `CheckpointedConnectorWithPermSync`
- `SlimConnectorWithPermSync`
- EE `external_permissions/box/doc_sync.py`
- EE `external_permissions/box/group_sync.py`
- file collaborations
- folder collaborations
- Box groups / group memberships
- shared link policy
- permission validation

推奨ポリシー:

- 権限不明文書はprivate扱い。
- shared linkは初期状態ではpublic扱いにしない。
- folder継承はfolder IDをexternal groupとして表現。

検証:

- user collaboration
- group collaboration
- folder inheritance
- external collaborator
- shared link
- 権限変更後のdoc sync

Exit条件:

- ユーザーごとに検索結果が正しく絞られる。
- 権限変更が同期される。
- Deep Researchが権限外文書を参照しない。

## Phase 4: Events API増分同期

期間目安: 2〜3週間

目的:

- 大規模Boxテナントでfull crawl依存を減らす。

実装範囲:

- Box Events API
- `stream_position` checkpoint
- 作成/更新/削除/移動/restoreイベント処理
- event重複排除
- stream position期限切れ時のfallback full crawl
- pruning連携

注意:

- enterprise eventsはlong polling不可。
- events保持期間に依存する。
- 欠落時はfull reconciliationが必要。

Exit条件:

- 更新/削除/移動が次回syncで反映される。
- event欠落時にfull crawlへ安全にfallbackする。

## Phase 5: Box Export Tool

期間目安: 1〜2週間

目的:

- Deep ResearchレポートをBoxへ保存。

実装範囲:

- `save_report_to_box` Tool
- Markdown upload
- folder ID指定
- new file / new version strategy
- file URL返却
- 保存失敗時のUI表示
- basic audit metadata

拡張:

- DOCX生成
- report template
- metadata instance付与
- 保存先folder policy

Exit条件:

- Deep Research結果をBox folderへ保存できる。
- 保存されたfile URLがチャットへ返る。

## Phase 6: 横断Deep Research Platform化

期間目安: 3〜6週間

目的:

- Box中心から、Slack / Teams / SharePoint / CRMを含む横断調査へ拡張。

実装範囲:

- source selection UI
- document set / folder / channel / account scope
- source別citation表示
- report template管理
- Box保存先マッピング
- 権限差分警告
- audit dashboard

Exit条件:

- ユーザーが調査sourceを選べる。
- 横断sourceからレポートを生成しBoxへ保存できる。
- 管理者がsource・保存先・権限ポリシーを管理できる。

## リスク

| リスク | 影響 | 対策 |
|---|---|---|
| CCG主体で見える範囲が期待と違う | 全社検索できない | Phase 0でenterprise/user subjectを検証 |
| Box権限継承が複雑 | ACL漏れ | conservative default、権限不明はprivate |
| Events API欠落 | 差分同期漏れ | 定期full reconciliation |
| 大規模folderでAPI制限 | sync遅延 | checkpoint粒度、rate limit backoff |
| レポート保存先が広すぎる | 情報漏洩 | 保存先権限差分チェック |
| Onyx EE依存 | OSSのみで権限同期不可 | 早期に利用Editionを確定 |

## 推奨マイルストーン

### M1: Box Search PoC

- Phase 0 + Phase 1
- 目安: 2週間
- 成果: Box文書をDeep Researchで引用

### M2: Enterprise-safe Search

- Phase 2 + Phase 3
- 目安: 4〜6週間
- 成果: Box権限同期つき検索

### M3: Research-to-Box

- Phase 5
- 目安: 1〜2週間
- 成果: レポートをBox保存

### M4: Multi-source Research Platform

- Phase 4 + Phase 6
- 目安: 6〜9週間
- 成果: Box中心の横断Deep Research基盤

## 次に決めること

- Box認証主体
  - enterprise
  - managed user
  - folder collaborator方式
- 初期スコープ
  - 指定folder
  - 全社
  - 部門単位
- 権限同期をPoCに含めるか
- レポート保存形式
  - Markdown
  - DOCX
  - PDF
- Onyx Enterprise Edition利用可否

