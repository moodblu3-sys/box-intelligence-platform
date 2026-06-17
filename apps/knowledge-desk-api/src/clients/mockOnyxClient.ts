import type { OnyxClient } from "./onyxClient.ts";
import type { OnyxQueryInput, OnyxQueryResult, OnyxSearchResult } from "../types.ts";

const BOX_EXTERNAL_SHARING_POLICY: OnyxSearchResult = {
  source: "Box",
  title: "Box外部共有運用ルール",
  url: "box://policies/external-sharing",
  score: 0.94,
  content: [
    "日新テクノロジー株式会社では、Boxフォルダを外部取引先に共有する場合、フォルダオーナーまたは共同所有者が外部コラボレーターとして招待する。",
    "共有前に、フォルダの機密区分が「公開可」または「社外共有可」であることを確認する。",
    "社外秘以上のフォルダでは共有リンクによる外部共有を禁止し、必要な場合は情シス承認済みの外部コラボレーター招待を使う。",
    "取引先のメールドメインが許可リストにない場合、外部コラボレーター申請を提出する。",
  ].join("\n"),
};

const SHAREPOINT_IT_FAQ: OnyxSearchResult = {
  source: "SharePoint",
  title: "外部ユーザーがBoxにアクセスできない場合のFAQ",
  url: "sharepoint://it-faq/box-external-user-access",
  score: 0.91,
  content: [
    "外部ユーザーがBoxにアクセスできない場合は、招待メールの宛先、ログインに使っているメールアドレス、迷惑メールフォルダ、招待の有効期限を確認する。",
    "共有リンクが無効な場合は、フォルダの機密区分、共有リンク設定、リンクの有効期限、パスワード設定を確認する。",
    "取引先ドメインが未許可の場合は、取引先ドメイン許可申請を情シスに提出する。",
    "アクセス確認時は、相手が個人アカウントではなく招待先の会社メールでログインしているかを確認する。",
  ].join("\n"),
};

const JIRA_RESOLUTION_HISTORY: OnyxSearchResult = {
  source: "Jira",
  title: "BOX-1423 取引先ドメイン未登録によるアクセス不可",
  url: "jira://BOX-1423",
  score: 0.88,
  content: [
    "BOX-1423では、取引先ドメインがBox外部共有の許可リストに登録されておらず、外部ユーザーが招待を受け取ってもフォルダにアクセスできなかった。",
    "解決策は、情シスでドメイン許可リストを確認し、部門長承認付きの外部コラボレーター申請を受けてドメインを追加することだった。",
    "関連事例として、BOX-1510では社外秘フォルダで共有リンクが無効化されていた。BOX-1661では招待メールが迷惑メール扱いになっていた。",
  ].join("\n"),
};

const EXTERNAL_SHARING_TERMS = [
  "Box",
  "box",
  "フォルダ",
  "共有",
  "外部共有",
  "取引先",
  "アクセスできない",
  "アクセス",
  "外部ユーザー",
];

export class MockOnyxClient implements OnyxClient {
  async query(input: OnyxQueryInput): Promise<OnyxQueryResult> {
    if (!this.matchesExternalSharingScenario(input.question)) {
      return {
        answer: null,
        results: [],
      };
    }

    return {
      answer: [
        "外部取引先がBoxフォルダにアクセスできない場合は、まず共有方法とフォルダの機密区分を確認してください。",
        "",
        "確認手順は次の通りです。",
        "1. フォルダの機密区分が外部共有可能か確認する。社外秘以上の場合、共有リンクではなく承認済みの外部コラボレーター招待が必要です。",
        "2. 招待先メールアドレスが取引先の会社メールで正しいか確認する。相手が別メールや個人アカウントでログインしているとアクセスできません。",
        "3. 取引先ドメインが外部共有の許可リストに登録済みか確認する。未登録なら情シスへドメイン許可申請を出します。",
        "4. 招待メールが迷惑メールに入っていないか、招待期限が切れていないかを相手に確認してもらいます。",
        "5. 共有リンクを使っている場合は、リンクの有効期限、パスワード設定、リンク対象範囲を確認します。",
        "",
        "過去事例では、取引先ドメイン未登録、社外秘フォルダでの共有リンク無効化、招待メールの迷惑メール振り分けが主な原因でした。",
      ].join("\n"),
      results: [
        BOX_EXTERNAL_SHARING_POLICY,
        SHAREPOINT_IT_FAQ,
        JIRA_RESOLUTION_HISTORY,
      ],
    };
  }

  private matchesExternalSharingScenario(question: string): boolean {
    const matchCount = EXTERNAL_SHARING_TERMS.filter((term) =>
      question.includes(term)
    ).length;

    return matchCount >= 3;
  }
}
