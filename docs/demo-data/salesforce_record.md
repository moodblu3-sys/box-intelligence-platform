# Salesforce Demo Record

想定ソース: Salesforce  
目的: 日新テクノロジー株式会社のAccountとOpportunityをOnyxに取り込み、Box / Teams / SharePointの情報と横断して参照できるようにする。

## Account

| Field | Value |
|---|---|
| Account Name | 日新テクノロジー株式会社 |
| Industry | 製造業 / 産業機器 |
| Employees | 1000 |
| Locations | 国内10拠点 |
| Existing Systems | Box, Microsoft 365, Salesforce |
| AI Interest | 生成AIを活用した社内ナレッジ検索、提案準備、問い合わせ対応 |
| Business Challenge | 過去資料を探す時間が長い。ナレッジが部門や個人に分散している。 |
| Security Concern | 権限外資料の露出、社内情報の外部利用、監査性不足 |
| Key Contacts | 高橋 健一（情報システム部長）、中村 真由美（執行役員 経営企画担当） |

## Opportunity

| Field | Value |
|---|---|
| Opportunity Name | 生成AI活用基盤導入 |
| Account | 日新テクノロジー株式会社 |
| Stage | Discovery / Solution Fit |
| Amount | 12,000,000 JPY |
| Decision Makers | 中村 真由美（執行役員）、高橋 健一（情報システム部長） |
| Timeline | 2026年7月にPoC開始判断。2026年9月に本番導入可否を判断。 |
| Pain Points | 過去提案書、議事録、製品資料を探すのに時間がかかる。Teams、SharePoint、Box、Salesforceに情報が分散。生成AI利用時のセキュリティ懸念。 |
| Success Criteria | 提案準備に必要な調査時間を30%以上削減。提案初稿作成時間を50%削減。回答に根拠資料リンクを付与。既存権限を尊重した検索を実現。 |
| Competitor / Alternative | Box AI単体、Microsoft Copilot単体、既存SharePoint検索 |
| Proposed Direction | Boxを中心に、Teams、SharePoint、Salesforceを横断するマルチソースRAG基盤をPoCで検証。 |
| Next Step | 次回提案でPoCスコープ、セキュリティ設計、評価指標、概算費用を提示。 |

## Sales Notes

- 顧客はBox AIに関心を持っているが、Box内資料だけでは課題解決が不十分と認識している。
- Teamsの議論やSalesforceの商談情報も含めて調査できる点が差別化要素。
- 初回PoCは全社展開ではなく、営業企画部門と情報システム部門に限定するのが妥当。
- セキュリティ説明では、権限継承、データ利用範囲、監査ログ、根拠リンクを明確にする必要がある。
