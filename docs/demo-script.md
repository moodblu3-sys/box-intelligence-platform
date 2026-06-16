# Box Intelligence Platform Demo Script

## Demo Scenario

顧客は日新テクノロジー株式会社。従業員1000名、国内10拠点を持つ製造業企業。Box、Microsoft 365、Salesforceを導入済みで、生成AI活用を検討している。

主な課題は、過去資料を探すのに時間がかかること、ナレッジが属人化していること、生成AIを活用したいがセキュリティ懸念があること。

このデモでは、Box AI単体ではなく、Box、Teams、SharePoint、Salesforceを横断して企業知識を調査し、提案方針、リスク、次アクションを整理できることを見せる。

## Data Placement

| Source | Demo Data |
|---|---|
| Box | `日新テクノロジー株式会社_初回ヒアリング議事録.docx` |
| Teams | 営業・SEチームのチャット履歴 18件 |
| Salesforce | Account: 日新テクノロジー株式会社 / Opportunity: 生成AI活用基盤導入 |
| SharePoint | Box AI標準機能まとめ、Enterprise Search設計メモ、セキュリティ・権限管理FAQ |

## Setup Steps

1. Boxに `docs/demo-data/box_meeting_minutes.docx` をアップロードする。
   - Box上のファイル名は `日新テクノロジー株式会社_初回ヒアリング議事録.docx` にする。
   - Boxにはこの議事録1件のみを置く。
2. Teamsに `docs/demo-data/teams_messages.md` のチャット履歴を投稿する。
   - 1件ずつ投稿してもよい。
   - デモ用チャンネルにまとめて投稿してもよい。
3. Salesforceに `docs/demo-data/salesforce_record.md` のAccountとOpportunityを作成する。
4. SharePointに `docs/demo-data/sharepoint_pages.md` の3ページを作成する。
5. Onyxで各Connectorを再indexする。
6. Existing ConnectorsでBox、Teams、SharePoint、SalesforceがIndexedになっていることを確認する。

## Demo Flow

### 1. Problem Framing

説明:

日新テクノロジー株式会社はBox、Microsoft 365、Salesforceをすでに使っている。しかし、必要な情報が複数システムに分散しており、過去資料の探索や提案準備に時間がかかっている。

見せる画面:

- Existing Connectors
- Box / Teams / SharePoint / Salesforce が接続済みであること

### 2. Single Source Limitation

説明:

Box AI単体でもBox内文書の要約はできる。しかし、今回の提案判断にはTeamsの温度感、Salesforceの商談条件、SharePointのセキュリティFAQも必要になる。

見せるポイント:

- Boxには議事録1件のみ
- 他ソースに判断材料を分散

### 3. Multi-source Question

Onyxに入力する質問:

```text
日新テクノロジー株式会社向けに
Box AI活用基盤を提案したい。

Boxの議事録、
Teamsの議論、
Salesforceの商談情報、
SharePointの製品資料

を踏まえて、

* 提案方針
* リスク
* 次アクション

を整理してください。
```

### 4. Expected Answer Review

確認する観点:

- Box議事録から顧客課題が拾えているか
- Teamsから温度感と勝ち筋が拾えているか
- SalesforceからStage、Amount、Decision Makers、Timelineが拾えているか
- SharePointからBox AI単体の限界、Enterprise Search設計、セキュリティFAQが拾えているか
- 回答が提案方針、リスク、次アクションに整理されているか
- 複数ソースへの引用が付いているか

## Talk Track

このデモのポイントは、Box AIを否定することではない。Boxを企業知識の中心に置きながら、Teams、SharePoint、Salesforceに分散した文脈を合わせて使うことで、提案準備や意思決定に使える回答を作る点にある。

日新テクノロジー株式会社のように、すでに複数SaaSを導入している企業では、AI活用の価値は単一文書の要約ではなく、社内情報の横断調査にある。

## Success Criteria

- 回答が4ソース以上を参照している。
- 提案方針、リスク、次アクションが分かれている。
- セキュリティ懸念への回答が含まれている。
- PoCスコープと成功指標が含まれている。
- Box AI単体では弱い理由が説明されている。
