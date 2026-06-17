# Knowledge Desk Design

## 目的

Knowledge Deskは、顧客企業の情シス部門向け社内問い合わせAIアプリである。社員からの問い合わせに対して、Box、SharePoint、Jiraに分散したナレッジを横断検索し、根拠付きの回答を返す。

MVPでは、Teams Bot本体やJira API連携は実装しない。まずAPI単体で、問い合わせ、ナレッジ検索結果の正規化、confidence判定、エスカレーション用Jira ticket draft生成までを確認できる状態にする。

## Onyxとの関係

Knowledge DeskはOnyx本体の中に問い合わせ業務ロジックを混ぜず、Onyxの上に乗る業務アプリとして実装する。

- Onyx: Box、SharePoint、Jiraなどのデータソースを接続し、検索・RAG基盤を提供する。
- Knowledge Desk API: 情シス問い合わせ業務に必要な回答形式、confidence判定、エスカレーション判定を担当する。

今回の実装では `OnyxClient` interfaceを定義し、`MockOnyxClient`でBox、SharePoint、Jira由来の検索結果を返す。将来的には同じinterfaceのまま、実Onyx APIクライアントへ差し替える。

## Box / SharePoint / Jira の役割

### Box

Boxは正式な運用ルール、申請書、管理ポリシーの保管場所として扱う。

例:

- Box外部共有運用ルール
- 機密区分別共有ポリシー
- 外部コラボレーター申請手順
- Box利用ガイド

Knowledge Deskでは、Boxを「正式ルールの根拠」として引用する。

### SharePoint

SharePointは情シス部門のFAQ、社内ポータル、手順書の保管場所として扱う。

例:

- 外部ユーザーがBoxにアクセスできない場合のFAQ
- 共有リンクが使えない場合の確認手順
- 取引先ドメイン許可申請の手順
- よくある問い合わせ集

Knowledge Deskでは、SharePointを「社員に案内する具体手順」として引用する。

### Jira

Jiraは過去問い合わせ、障害対応、解決履歴の保管場所として扱う。

例:

- BOX-1423: 取引先ドメインが未登録で外部ユーザーがアクセスできなかった
- BOX-1510: 社外秘フォルダで共有リンクが無効化されていた
- BOX-1661: 外部コラボレーター招待メールが迷惑メール扱いになっていた
- BOX-1722: 退職済み担当者がフォルダオーナーのままで権限変更できなかった

Knowledge Deskでは、Jiraを「過去に実際に起きた原因と解決策」として引用する。

## Teams Botとの将来連携

将来的にはTeams BotをKnowledge Desk APIの入口にする。

想定フロー:

1. 社員がTeamsで情シスBotに質問する。
2. Teams Botが `POST /api/knowledge-desk/query` を呼ぶ。
3. Knowledge Desk APIがOnyxを通じてBox、SharePoint、Jiraを検索する。
4. 回答、引用元、confidence、エスカレーション判定をTeamsに返す。
5. 解決できない場合は、Jira ticket draftを社員または情シス担当者に提示する。

MVPではTeams Botは作らず、API単体で同じ入力・出力を確認する。

## Jira起票との将来連携

MVPではJira APIを呼ばない。`needsEscalation=true` の場合に、Jira起票用draftだけを返す。

将来実装では、次の流れに拡張する。

1. Knowledge Desk APIがconfidenceを算出する。
2. confidenceが低い場合、Jira ticket draftを生成する。
3. Teams上で社員または情シス担当者が内容を確認する。
4. 承認後にJira APIでチケットを作成する。
5. 作成したJiraチケットURLをTeamsへ返す。

この段階を踏むことで、AIが勝手にチケットを大量起票することを避ける。

## Box AI単体との差別化

Box AI単体は、Box内の文書要約やBox文書に対する質問応答に強い。一方、情シス問い合わせでは、正式ルールだけでなく、FAQ、社内手順、過去の障害対応履歴が必要になる。

Knowledge Deskの差別化は次の点にある。

- Boxの正式ルールだけでなく、SharePointのFAQも参照する。
- Jiraの過去解決履歴から、実際に多い原因を回答に反映する。
- 複数sourceが揃っているかをconfidenceに反映する。
- 解決できない場合はJira ticket draftを作る。
- Teams BotやJira起票に拡張しやすい業務アプリとして分離されている。

つまり、Knowledge DeskはBox AIを置き換えるものではなく、Boxを含む企業ナレッジを情シス問い合わせ業務に接続するアプリである。
